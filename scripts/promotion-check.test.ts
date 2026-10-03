import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// 昇格の確認（scripts/promotion-check.sh）と昇格 PR の作成（scripts/promote.sh）を、
// 使い捨ての Git リポジトリ（origin を模した bare リポジトリと、その clone）で走らせる

const scriptsDir = resolve(import.meta.dirname)

let dir: string
let work: string

const run = (cmd: string, args: string[], cwd = work) => {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
  })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}
const git = (...args: string[]) => {
  const r = run('git', args)
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.out}`)
  return r.out.trim()
}
const commit = (name: string) => {
  writeFileSync(join(work, name), name)
  git('add', '-A')
  git('commit', '-q', '-m', name)
  return git('rev-parse', 'HEAD')
}
const setVersion = (env: string, sha: string) => writeFileSync(join(work, 'deploy', env, 'version'), `${sha}\n`)
/** main に昇格をマージした状態を作る（squash と同じく main の上の1コミット）。 */
const promoteOnMain = (env: string, sha: string) => {
  setVersion(env, sha)
  git('commit', '-q', '-am', `Promote ${sha.slice(0, 7)} to ${env}`)
  git('push', '-q', 'origin', 'main')
}
const check = (...args: string[]) => run(join(work, 'scripts/promotion-check.sh'), [...args, '--main', 'origin/main'])

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'promotion-'))
  work = join(dir, 'work')
  run('git', ['init', '-q', '--bare', '-b', 'main', join(dir, 'origin.git')], dir)
  run('git', ['clone', '-q', join(dir, 'origin.git'), work], dir)
  git('switch', '-q', '-c', 'main')
  mkdirSync(join(work, 'scripts'))
  for (const s of ['promotion-check.sh', 'promote.sh']) cpSync(join(scriptsDir, s), join(work, 'scripts', s))
  for (const env of ['staging', 'production']) {
    mkdirSync(join(work, 'deploy', env), { recursive: true })
    writeFileSync(join(work, 'deploy', env, 'version'), '')
  }
  commit('a')
  git('push', '-q', '-u', 'origin', 'main')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('promotion-check', () => {
  it('main の祖先の SHA を staging に通す', () => {
    const sha = commit('b')
    git('push', '-q', 'origin', 'main')
    setVersion('staging', sha)
    const r = check('staging')
    expect(r.status, r.out).toBe(0)
  })

  it('main の祖先でない SHA を止める', () => {
    git('switch', '-q', '-c', 'side')
    const side = commit('side')
    git('switch', '-q', 'main')
    setVersion('staging', side)
    const r = check('staging')
    expect(r.status).toBe(1)
    expect(r.out).toContain('祖先でない')
  })

  it('リポジトリに無い SHA を止める', () => {
    setVersion('staging', 'f'.repeat(40))
    const r = check('staging')
    expect(r.status).toBe(1)
    expect(r.out).toContain('リポジトリに無い')
  })

  it('40桁の SHA でない値を止める', () => {
    setVersion('staging', git('rev-parse', '--short', 'HEAD'))
    const r = check('staging')
    expect(r.status).toBe(1)
    expect(r.out).toContain('40桁')
  })

  it('staging に出していない SHA を本番に通さない', () => {
    const b = commit('b')
    const c = commit('c')
    git('push', '-q', 'origin', 'main')
    promoteOnMain('staging', b)
    setVersion('production', c)
    const r = check('production')
    expect(r.status).toBe(1)
    expect(r.out).toContain('staging に出したことがない')
  })

  it('staging に出したことのある SHA を本番に通す（今の staging より前の値も）', () => {
    const b = commit('b')
    const c = commit('c')
    git('push', '-q', 'origin', 'main')
    promoteOnMain('staging', b)
    promoteOnMain('staging', c)
    setVersion('production', b)
    const r = check('production')
    expect(r.status, r.out).toBe(0)
  })

  it('マージコミットで入れた昇格の、途中のコミットの値を staging に出したことに数えない', () => {
    const b = commit('b')
    const c = commit('c')
    git('push', '-q', 'origin', 'main')
    git('switch', '-q', '-c', 'promote')
    setVersion('staging', b)
    git('commit', '-q', '-am', 'staging b')
    setVersion('staging', c)
    git('commit', '-q', '-am', 'staging c')
    git('switch', '-q', 'main')
    git('merge', '-q', '--no-ff', '-m', 'Merge promote', 'promote')
    git('push', '-q', 'origin', 'main')
    setVersion('production', b)
    const r = check('production')
    expect(r.status).toBe(1)
    expect(r.out).toContain('staging に出したことがない')
    setVersion('production', c)
    expect(check('production').status).toBe(0)
  })

  it('同じ PR で staging と本番を同じ SHA に書き換えても、本番は通さない', () => {
    const b = commit('b')
    git('push', '-q', 'origin', 'main')
    setVersion('staging', b)
    setVersion('production', b)
    const r = check('staging', 'production')
    expect(r.status).toBe(1)
    expect(r.out).toContain('staging ← ')
    expect(r.out).toContain('staging に出したことがない')
  })
})

describe('promote', () => {
  const promote = (...args: string[]) => run(join(work, 'scripts/promote.sh'), args)
  const version = (env: string) => readFileSync(join(work, 'deploy', env, 'version'), 'utf8').trim()

  it('staging: origin/main の先頭の SHA で昇格のブランチとコミットを作る', () => {
    const b = commit('b')
    git('push', '-q', 'origin', 'main')
    const r = promote('staging')
    expect(r.status, r.out).toBe(0)
    expect(git('branch', '--show-current')).toBe(`promote/staging-${b.slice(0, 7)}`)
    expect(version('staging')).toBe(b)
    expect(git('log', '-1', '--format=%s')).toBe(`Promote ${b.slice(0, 7)} to staging`)
    expect(git('rev-parse', 'HEAD~1')).toBe(b)
  })

  it('production: origin/main の deploy/staging/version の SHA を書く', () => {
    const b = commit('b')
    git('push', '-q', 'origin', 'main')
    promoteOnMain('staging', b)
    const r = promote('production')
    expect(r.status, r.out).toBe(0)
    expect(version('production')).toBe(b)
  })

  it('production: staging に出す前は作らない', () => {
    const r = promote('production')
    expect(r.status).toBe(1)
    expect(git('branch', '--show-current')).toBe('main')
  })

  it('SHA の指定が確認に通らなければ、ブランチを残さず元に戻る', () => {
    const b = commit('b')
    git('push', '-q', 'origin', 'main')
    promoteOnMain('staging', b)
    const unstaged = commit('c')
    git('push', '-q', 'origin', 'main')
    const r = promote('production', unstaged)
    expect(r.status).toBe(1)
    expect(git('branch', '--show-current')).toBe('main')
    expect(git('branch', '--list', 'promote/*')).toBe('')
    expect(git('status', '--porcelain')).toBe('')
  })

  it('宣言が今の値と同じなら作らない', () => {
    const b = commit('b')
    git('push', '-q', 'origin', 'main')
    promoteOnMain('staging', b)
    const r = promote('staging', b)
    expect(r.status).toBe(1)
    expect(r.out).toContain('すでに')
    expect(git('branch', '--list', 'promote/*')).toBe('')
  })

  it('作業ツリーに変更があれば何もしない', () => {
    writeFileSync(join(work, 'a'), 'changed')
    const r = promote('staging')
    expect(r.status).toBe(1)
    expect(git('branch', '--show-current')).toBe('main')
  })
})

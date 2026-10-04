/**
 * migrate.ts の出力を、マイグレーションだけを当てた空のローカルの D1・R2 に入れて確かめる（design-spec 9章）。
 *
 *   bun scripts/migrate-legacy/verify.ts
 *
 * 1. 一時ディレクトリに D1・R2 の状態を作り、staging・本番（docs/04_deployment-procedure.md 3章 Step 7）と同じ
 *    wrangler のコマンドを `--local` で流す。make dev・make e2e が使う `.wrangler/` の中身には触れない
 * 2. 取り出した件数（counts.json）と D1・R2 の件数を照合する
 * 3. ローカルの設定でビルドし直した Worker（dist/ を上書きする）をその状態で起動し、管理者のセッションで
 *    ヘッドレスの Chromium から管理画面を開き、中身ごとに日本語・English のタブの値が D1 と一致すること、
 *    画像が `/media/*` から返ることを確かめる
 *
 * .dev.vars の ADMIN_GITHUB_USER_ID（管理画面に入るため）と Playwright の Chromium（make setup）が要る。make e2e と同じ。
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { type BrowserContext, chromium, expect, type Page } from '@playwright/test'
import { drizzle } from 'drizzle-orm/d1'
import { getPlatformProxy } from 'wrangler'
import * as schema from '../../src/db/schema'
import { sessionCookieSettings } from '../../tests/support/session-cookie'
import { signCookieValue } from '../../tests/support/signed-cookie'
import { OUT_DIR } from './migrate'

const ROOT = path.join(import.meta.dirname, '..', '..')
// SITE_URL（wrangler.jsonc のローカルの値）と同じ origin で開く。Better Auth は SITE_URL を自分の origin とみなす
const PORT = 3000
const BASE_URL = `http://localhost:${PORT}`
const D1 = 'eastx-db-local'
const R2 = 'eastx-media-local'
// 確認の問い合わせを出させない。CLOUDFLARE_ENV があると staging・本番の設定でビルド・起動するので外す
const CHILD_ENV = { ...process.env, CI: '1', CLOUDFLARE_ENV: '' }

function wrangler(args: string[], persistTo: string): string {
  // -c を省くと、wrangler は直前の make build が残した dist/ の設定（staging・本番のこともある）へ移る
  const result = spawnSync(
    'bunx',
    ['wrangler', ...args, '-c', 'wrangler.jsonc', '--local', '--persist-to', persistTo],
    { cwd: ROOT, encoding: 'utf8', env: CHILD_ENV },
  )
  if (result.status !== 0) throw new Error(`wrangler ${args.join(' ')} が失敗した:\n${result.stderr}${result.stdout}`)
  return result.stdout
}

function query<T>(sql: string, persistTo: string): T[] {
  const out = wrangler(['d1', 'execute', D1, '--json', '--command', sql], persistTo)
  const parsed = JSON.parse(out) as { results: T[] }[]
  return parsed[0]?.results ?? []
}

/** localhost は IPv4・IPv6 のどちらにも解決されうるので、両方を見る */
async function portInUse(port: number): Promise<boolean> {
  const listening = (host: string) =>
    new Promise<boolean>((resolve) => {
      const socket = createConnection({ port, host })
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => resolve(false))
    })
  return (await Promise.all([listening('127.0.0.1'), listening('::1')])).some(Boolean)
}

/** 接続を拒まれた失敗か。Bun（このスクリプトを動かす）はエラー自身に、Node.js は cause に別の名前で載せる */
function isConnectionRefused(error: unknown): boolean {
  const code = (e: unknown) => (e as { code?: unknown } | undefined)?.code
  return error instanceof Error && (code(error) === 'ConnectionRefused' || code(error.cause) === 'ECONNREFUSED')
}

async function waitForServer(server: ChildProcess, log: () => string): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`wrangler dev が終了した（${server.exitCode}）:\n${log()}`)
    try {
      if ((await fetch(`${BASE_URL}/ja`)).ok) return
    } catch (error) {
      // 起動前は接続を拒まれるので、待ってやり直す。それ以外の失敗はそのまま投げる
      if (!isConnectionRefused(error)) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`wrangler dev が60秒以内に起動しなかった:\n${log()}`)
}

/**
 * bunx は wrangler を、wrangler は workerd を子として起動する。bunx だけを止めると workerd がポートと一時ディレクトリを
 * 握ったまま残るので、プロセスグループごと止め、終わるのを待つ
 */
async function stopServer(server: ChildProcess): Promise<void> {
  if (server.pid === undefined) return
  const pid = server.pid
  // bunx が先に終わっていても、グループに workerd が残っていることがあるので、グループには必ず送る
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal)
    } catch (error) {
      // ESRCH はグループに誰も残っていないこと。止める相手がいないので、それ以外だけを投げる
      if ((error as { code?: string }).code !== 'ESRCH') throw error
    }
  }
  const exited =
    server.exitCode !== null || server.signalCode !== null
      ? Promise.resolve()
      : new Promise((resolve) => server.once('exit', resolve))
  signalGroup('SIGTERM')
  const timeout = new Promise((resolve) => setTimeout(resolve, 10_000, 'timeout'))
  if ((await Promise.race([exited, timeout])) === 'timeout') {
    signalGroup('SIGKILL')
    await exited
  }
}

/** 管理者の行とセッションを一時の D1 に作り、ブラウザに渡す Cookie を返す（tests/e2e/fixtures.ts と同じ方式） */
async function adminCookie(persistTo: string): Promise<{ name: string; value: string }> {
  const proxy = await getPlatformProxy<Env>({
    configPath: path.join(ROOT, 'wrangler.jsonc'),
    persist: { path: path.join(persistTo, 'v3') },
    remoteBindings: false,
  })
  try {
    if (proxy.env.ENVIRONMENT !== 'local') throw new Error(`ENVIRONMENT=${proxy.env.ENVIRONMENT} の設定を開いた`)
    if (proxy.env.ADMIN_GITHUB_USER_ID === '') {
      throw new Error('管理画面に入るには .dev.vars の ADMIN_GITHUB_USER_ID が要る（docs/03_dev-setup.md 6章）')
    }
    const db = drizzle(proxy.env.DB, { schema })
    const now = new Date()
    const userId = crypto.randomUUID()
    await db.insert(schema.adminUser).values({
      id: userId,
      name: 'migrate-legacy-verify',
      email: `${userId}@example.invalid`,
      githubUserId: proxy.env.ADMIN_GITHUB_USER_ID,
      githubLogin: 'migrate-legacy-verify',
      createdAt: now,
      updatedAt: now,
    })
    const token = crypto.randomUUID().replaceAll('-', '')
    await db.insert(schema.adminSession).values({
      id: crypto.randomUUID(),
      token,
      userId,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    })
    const { cookieName, secret } = await sessionCookieSettings(proxy.env)
    return { name: cookieName, value: await signCookieValue(token, secret) }
  } finally {
    await proxy.dispose()
  }
}

type Lang = 'ja' | 'en'
const TABS: Record<Lang, string> = { ja: '日本語', en: 'English' }
/** 作品・プロジェクトの詳細本文のエディタの名前の後ろに付く言語（src/admin/long-form.tsx） */
const EDITOR_SUFFIX: Record<Lang, string> = { ja: '（日本語）', en: '（英語）' }

/** 確かめる欄。`field` は言語タブの中の入力欄、`editor` はタブの外の詳細本文のエディタ */
type Check = { kind: 'field' | 'editor'; label: string; values: Record<Lang, string | null> }

/** 編集ビューの言語タブを切り替え、欄ごとの値が D1 の値（空なら空欄）と一致することを確かめる */
async function expectBothLanguages(page: Page, url: string, checks: Check[]): Promise<void> {
  await page.goto(`${BASE_URL}${url}`)
  for (const lang of ['ja', 'en'] as const) {
    await page.getByRole('tab', { name: new RegExp(TABS[lang]) }).click()
    for (const check of checks) {
      const value = check.values[lang]
      const where = `${url} の ${TABS[lang]} の ${check.label}`
      if (check.kind === 'field') {
        const panel = page.getByRole('tabpanel', { name: new RegExp(TABS[lang]) })
        await expect(panel.getByLabel(check.label, { exact: true }), where).toHaveValue(value ?? '')
      } else {
        // CodeMirror は1行ずつ別の要素に描き、要素の間に改行を置かないので、改行を除いた文字列で比べる
        const editor = page.getByRole('textbox', { name: `${check.label}${EDITOR_SUFFIX[lang]}` })
        await expect(editor, where).toHaveText((value ?? '').replaceAll('\n', ''))
      }
    }
  }
}

const both = (row: Record<string, string | null>, column: string) => ({
  ja: row[`${column}_ja`] ?? null,
  en: row[`${column}_en`] ?? null,
})

async function checkAdmin(context: BrowserContext, persistTo: string, images: { key: string; contentType: string }[]) {
  const page = await context.newPage()

  const [profile] = query<Record<string, string | null>>('select * from profile', persistTo)
  if (!profile) throw new Error('profile が無い')
  await expectBothLanguages(page, '/admin/profile', [
    { kind: 'field', label: '名前', values: both(profile, 'name') },
    { kind: 'field', label: '自己紹介', values: both(profile, 'bio') },
  ])
  const links = query<{ url: string }>('select url from social_link order by sort_order', persistTo)
  const urlFields = page.getByRole('textbox', { name: 'URL', exact: true })
  await expect(urlFields).toHaveCount(links.length)
  for (const [i, link] of links.entries()) await expect(urlFields.nth(i)).toHaveValue(link.url)
  console.log(`profile: 名前・自己紹介を日英とも、SNS リンク ${links.length} 件を管理画面で確かめた`)

  for (const career of query<Record<string, string | null>>('select * from career', persistTo)) {
    await expectBothLanguages(page, `/admin/careers/${career.id}`, [
      { kind: 'field', label: 'タイトル', values: both(career, 'title') },
      { kind: 'field', label: '所属', values: both(career, 'organization') },
      { kind: 'field', label: '場所', values: both(career, 'location') },
      { kind: 'field', label: '内容', values: both(career, 'body') },
    ])
  }
  console.log('career: タイトル・所属・場所・内容を日英とも管理画面で確かめた')

  for (const [table, route] of [
    ['work', 'works'],
    ['project', 'projects'],
  ] as const) {
    const rows = query<Record<string, string | null>>(`select * from "${table}"`, persistTo)
    for (const row of rows) {
      await expectBothLanguages(page, `/admin/${route}/${row.id}`, [
        { kind: 'field', label: 'タイトル', values: both(row, 'title') },
        { kind: 'field', label: '概要', values: both(row, 'summary') },
        { kind: 'editor', label: '詳細本文', values: both(row, 'body') },
      ])
    }
    console.log(`${table}: ${rows.length} 件のタイトル・概要・詳細本文を日英とも管理画面で確かめた`)
  }

  await page.goto(`${BASE_URL}/admin/stacks`)
  const stacks = query<{ display_name: string }>('select display_name from stack', persistTo)
  const table = page.getByRole('table', { name: '使用技術の一覧' })
  for (const s of stacks) {
    await expect(table.getByText(s.display_name, { exact: true }).first()).toBeVisible()
  }
  console.log(`stack: ${stacks.length} 件を管理画面の一覧で確かめた`)

  for (const img of images) {
    const response = await context.request.get(`${BASE_URL}/media/${img.key}`)
    if (response.status() !== 200 || response.headers()['content-type'] !== img.contentType) {
      throw new Error(`/media/${img.key}: ${response.status()} ${response.headers()['content-type']}`)
    }
  }
  console.log(`画像: ${images.length} 件が /media/* から返った`)
}

async function main() {
  const counts = JSON.parse(await readFile(path.join(OUT_DIR, 'counts.json'), 'utf8')) as Record<string, number>
  const images = (await readFile(path.join(OUT_DIR, 'images.tsv'), 'utf8'))
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [key = '', file = '', contentType = ''] = line.split('\t')
      return { key, file, contentType }
    })
  if (await portInUse(PORT)) throw new Error(`ポート ${PORT} が使われている。make dev などを止めてから走らせる`)

  const persistTo = await mkdtemp(path.join(tmpdir(), 'eastx-migrate-legacy-'))
  let server: ChildProcess | undefined
  let cleaning: Promise<void> | undefined
  // Ctrl-C と main の finally の両方から呼ばれても1回だけ片付ける。一時ディレクトリを消せなくても、
  // 確認の結果（成功・本来の失敗）を上書きしないよう、場所を出すだけにする
  const cleanUp = () => {
    cleaning ??= (async () => {
      if (server) await stopServer(server)
      await rm(persistTo, { recursive: true, force: true }).catch((error: unknown) => {
        console.error(`一時ディレクトリ ${persistTo} を消せなかった:`, error)
      })
    })()
    return cleaning
  }
  // Ctrl-C でも workerd と一時ディレクトリを残さない
  process.once('SIGINT', () => {
    void cleanUp().finally(() => process.exit(130))
  })

  try {
    // 1. 空の D1 にマイグレーションだけを当て、SQL と画像を入れる
    wrangler(['d1', 'migrations', 'apply', D1], persistTo)
    wrangler(['d1', 'execute', D1, '--file', path.join(OUT_DIR, 'legacy.sql')], persistTo)
    for (const img of images) {
      wrangler(
        ['r2', 'object', 'put', `${R2}/${img.key}`, '--file', img.file, '--content-type', img.contentType],
        persistTo,
      )
    }

    // 2. 件数の照合。経歴・作品・プロジェクトは下書きで入る（design-spec 9章）
    if (images.length !== counts.image)
      throw new Error(`画像の数が合わない: 取り出し ${counts.image} ／ 一覧 ${images.length}`)
    const tables = Object.keys(counts).filter((t) => t !== 'image')
    const [actual] = query<Record<string, number>>(
      `select ${tables.map((t) => `(select count(*) from "${t}") as "${t}"`).join(', ')}`,
      persistTo,
    )
    const mismatches = tables.filter((t) => actual?.[t] !== counts[t])
    if (mismatches.length > 0) {
      throw new Error(
        `件数が合わない: ${mismatches.map((t) => `${t} 取り出し ${counts[t]} ／ D1 ${actual?.[t]}`).join(', ')}`,
      )
    }
    const [published] = query<{ n: number }>(
      "select (select count(*) from career where status <> 'draft') + (select count(*) from work where status <> 'draft') + (select count(*) from project where status <> 'draft') as n",
      persistTo,
    )
    if (published?.n !== 0) throw new Error(`下書きでない行が ${published?.n} 件ある`)
    console.log('件数が一致した:', [...tables, 'image'].map((t) => `${t} ${counts[t]}`).join(' '))

    // 3. 管理画面で日英の中身を見る
    const cookie = await adminCookie(persistTo)
    const build = spawnSync('bunx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit', env: CHILD_ENV })
    if (build.status !== 0) throw new Error('vite build が失敗した')
    let serverLog = ''
    server = spawn(
      'bunx',
      ['wrangler', 'dev', '-c', 'dist/server/wrangler.json', '--port', String(PORT), '--persist-to', persistTo],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: CHILD_ENV, detached: true },
    )
    for (const stream of [server.stdout, server.stderr]) {
      stream?.on('data', (chunk: Buffer) => {
        serverLog = `${serverLog}${chunk.toString()}`.slice(-10_000)
      })
    }
    await waitForServer(server, () => serverLog)

    const browser = await chromium.launch()
    try {
      // CodeMirror は画面に入る行だけを描くので、詳細本文が全部描かれるだけの高さの画面で開く
      const context = await browser.newContext({ viewport: { width: 1280, height: 8000 } })
      await context.addCookies([{ ...cookie, url: BASE_URL, httpOnly: true, sameSite: 'Lax' }])
      await checkAdmin(context, persistTo, images)
    } finally {
      await browser.close()
    }
  } finally {
    await cleanUp()
  }
}

await main()

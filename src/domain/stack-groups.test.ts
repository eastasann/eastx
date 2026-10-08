import { describe, expect, it } from 'vitest'
import { type StackCategory, toStackGroups } from './stack-groups'

const s = (key: string, category: StackCategory, isCore = false) => ({ key, category, isCore })
const keysOf = (groups: ReturnType<typeof toStackGroups<ReturnType<typeof s>>>) =>
  groups.map((group) => [group.key, group.stacks.map((stack) => stack.key)])

describe('toStackGroups（design-spec 6.1.4）', () => {
  it('Core → Languages → Frameworks → Infrastructure → Tools の順に分け、Core の技術は Core の群にだけ入れる', () => {
    const stacks = [
      s('git', 'tools'),
      s('docker', 'infrastructure'),
      s('react', 'frameworks', true),
      s('python', 'languages'),
      s('typescript', 'languages', true),
      s('vue', 'frameworks'),
    ]
    expect(keysOf(toStackGroups(stacks))).toEqual([
      ['core', ['react', 'typescript']],
      ['languages', ['python']],
      ['frameworks', ['vue']],
      ['infrastructure', ['docker']],
      ['tools', ['git']],
    ])
  })

  it('群の中は入力の順（表示順）のまま', () => {
    const stacks = [s('c', 'tools'), s('a', 'tools'), s('b', 'tools'), s('z', 'languages', true), s('y', 'tools', true)]
    expect(keysOf(toStackGroups(stacks))).toEqual([
      ['core', ['z', 'y']],
      ['tools', ['c', 'a', 'b']],
    ])
  })

  it('技術の無い群は含めない。Core が0件なら Core の群が無い', () => {
    expect(keysOf(toStackGroups([s('go', 'languages'), s('git', 'tools')]))).toEqual([
      ['languages', ['go']],
      ['tools', ['git']],
    ])
  })

  it('全部が Core なら Core の群だけ', () => {
    expect(keysOf(toStackGroups([s('react', 'frameworks', true), s('go', 'languages', true)]))).toEqual([
      ['core', ['react', 'go']],
    ])
  })

  it('入力が空なら空の配列', () => {
    expect(toStackGroups([])).toEqual([])
  })
})

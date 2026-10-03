import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { nextThemePreference, parseThemePreference, THEME_INIT_SCRIPT } from './preferences'

describe('テーマの設定', () => {
  it('「OSに合わせる → ライト → ダーク」の順に巡る', () => {
    expect(nextThemePreference('system')).toBe('light')
    expect(nextThemePreference('light')).toBe('dark')
    expect(nextThemePreference('dark')).toBe('system')
  })

  it('Cookie の値が light・dark 以外なら OS に合わせる', () => {
    expect(parseThemePreference('light')).toBe('light')
    expect(parseThemePreference('dark')).toBe('dark')
    expect(parseThemePreference(undefined)).toBe('system')
    expect(parseThemePreference('blue')).toBe('system')
  })
})

describe('THEME_INIT_SCRIPT', () => {
  function run(cookie: string, osDark: boolean): string | undefined {
    const documentElement = { dataset: {} as Record<string, string> }
    runInNewContext(THEME_INIT_SCRIPT, {
      document: { cookie, documentElement },
      matchMedia: (query: string) => ({ matches: query === '(prefers-color-scheme: dark)' && osDark }),
    })
    return documentElement.dataset.theme
  }

  it('覚えている設定があればそれを使う', () => {
    expect(run('a=1; eastx-theme=dark; b=2', false)).toBe('dark')
    expect(run('eastx-theme=light', true)).toBe('light')
  })

  it('OS に合わせる設定・覚えていないときは OS の設定を見る', () => {
    expect(run('eastx-theme=system', true)).toBe('dark')
    expect(run('', false)).toBe('light')
  })

  it('名前の一部が同じ別の Cookie は読まない', () => {
    expect(run('x-eastx-theme=dark', false)).toBe('light')
    expect(run('eastx-theme=darker', false)).toBe('light')
  })
})

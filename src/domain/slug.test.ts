import { describe, expect, it } from 'vitest'
import { firstAvailable, SLUG_MAX_LENGTH, SLUG_PATTERN, slugify, stackKeyBase } from './slug'

describe('slugify', () => {
  it('英小文字・数字・ハイフンにする', () => {
    expect(slugify('My App')).toBe('my-app')
    expect(slugify('  TanStack Start on Workers!  ')).toBe('tanstack-start-on-workers')
    expect(slugify('Next.js 15')).toBe('next-js-15')
  })

  it('アクセント付きの文字は基の文字に戻す', () => {
    expect(slugify('Café Résumé')).toBe('cafe-resume')
  })

  it('英数字以外の並びはハイフン1つにまとめ、両端のハイフンを落とす', () => {
    expect(slugify('--a  &&  b--')).toBe('a-b')
  })

  it('変換して空になるときは null', () => {
    expect(slugify('日本語のタイトル')).toBeNull()
    expect(slugify('!!!')).toBeNull()
    expect(slugify('')).toBeNull()
  })

  it('上限の文字数で切り、切った末尾のハイフンを落とす', () => {
    const slug = slugify(`${'a'.repeat(SLUG_MAX_LENGTH - 1)} bcd`)
    expect(slug).toBe('a'.repeat(SLUG_MAX_LENGTH - 1))
    expect(slugify('x'.repeat(SLUG_MAX_LENGTH + 20))).toHaveLength(SLUG_MAX_LENGTH)
  })
})

describe('SLUG_PATTERN', () => {
  it('英小文字・数字・ハイフンだけを通す', () => {
    expect(SLUG_PATTERN.test('my-app-2')).toBe(true)
    expect(SLUG_PATTERN.test('My-App')).toBe(false)
    expect(SLUG_PATTERN.test('my_app')).toBe(false)
    expect(SLUG_PATTERN.test('')).toBe(false)
  })
})

describe('firstAvailable', () => {
  it('使われていなければそのまま', () => {
    expect(firstAvailable('my-app', () => false)).toBe('my-app')
  })

  it('重複すれば -2、-3 … を付ける', () => {
    const taken = new Set(['my-app', 'my-app-2'])
    expect(firstAvailable('my-app', (s) => taken.has(s))).toBe('my-app-3')
  })

  it('連番を付けても上限に収まるよう base を削る', () => {
    const base = 'a'.repeat(SLUG_MAX_LENGTH)
    const result = firstAvailable(base, (s) => s === base)
    expect(result).toBe(`${'a'.repeat(SLUG_MAX_LENGTH - 2)}-2`)
    expect(result).toHaveLength(SLUG_MAX_LENGTH)
  })
})

describe('stackKeyBase', () => {
  it('表示名から作り、空になるときは stack', () => {
    expect(stackKeyBase('Next.js')).toBe('next-js')
    expect(stackKeyBase('日本語')).toBe('stack')
  })
})

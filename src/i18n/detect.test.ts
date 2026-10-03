import { describe, expect, it } from 'vitest'
import { detectLang, primaryLanguageTag, readCookie } from './detect'

describe('readCookie', () => {
  it('名前が一致する値だけを返す', () => {
    expect(readCookie('a=1; eastx-lang=ja; b=2', 'eastx-lang')).toBe('ja')
    expect(readCookie('eastx-lang-x=en', 'eastx-lang')).toBeUndefined()
    expect(readCookie(null, 'eastx-lang')).toBeUndefined()
  })
})

describe('primaryLanguageTag', () => {
  it('q 値の降順で最優先のタグを返す', () => {
    expect(primaryLanguageTag('en;q=0.8, ja')).toBe('ja')
    expect(primaryLanguageTag('ja-JP,ja;q=0.9,en-US;q=0.8')).toBe('ja-JP')
    expect(primaryLanguageTag('en-US,en;q=0.9')).toBe('en-US')
  })

  it('ヘッダーがなければ undefined', () => {
    expect(primaryLanguageTag(null)).toBeUndefined()
    expect(primaryLanguageTag('')).toBeUndefined()
  })

  it('q=0（受け入れない宣言）のタグは候補から外す', () => {
    expect(primaryLanguageTag('ja;q=0, en')).toBe('en')
    expect(primaryLanguageTag('ja;q=0')).toBeUndefined()
  })
})

describe('detectLang', () => {
  it('Cookie の言語を最優先にする', () => {
    expect(detectLang('eastx-lang=en', 'ja-JP')).toBe('en')
    expect(detectLang('eastx-lang=ja', 'en-US')).toBe('ja')
  })

  it('Cookie が不正・無いときはブラウザの最優先の言語で決める', () => {
    expect(detectLang('eastx-lang=fr', 'ja-JP,en;q=0.8')).toBe('ja')
    expect(detectLang(null, 'ja')).toBe('ja')
    expect(detectLang(null, 'en-US,ja;q=0.9')).toBe('en')
    expect(detectLang(null, null)).toBe('en')
  })
})

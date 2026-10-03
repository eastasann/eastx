import { describe, expect, it } from 'vitest'
import { hasLanguage, languagesOf } from './languages'

describe('hasLanguage', () => {
  it('ブログ・コーディング記録はタイトルと本文の両方', () => {
    expect(hasLanguage('titleAndBody', { title: 'T', body: 'B' })).toBe(true)
    expect(hasLanguage('titleAndBody', { title: 'T', body: null })).toBe(false)
    expect(hasLanguage('titleAndBody', { title: null, body: 'B' })).toBe(false)
  })

  it('プロフィールは名前', () => {
    expect(hasLanguage('name', { name: '東' })).toBe(true)
    expect(hasLanguage('name', { name: null })).toBe(false)
  })

  it('経歴・作品・プロジェクトはタイトル', () => {
    expect(hasLanguage('title', { title: 'T', body: null })).toBe(true)
    expect(hasLanguage('title', { title: '   ' })).toBe(false)
  })
})

describe('languagesOf', () => {
  it('言語ごとに判定する', () => {
    expect(languagesOf('title', { title: 'タイトル' }, { title: null })).toEqual({ ja: true, en: false })
    expect(languagesOf('titleAndBody', { title: 'a', body: 'b' }, { title: 'c', body: 'd' })).toEqual({
      ja: true,
      en: true,
    })
  })
})

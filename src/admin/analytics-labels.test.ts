import { describe, expect, it } from 'vitest'
import {
  countryName,
  formatChange,
  formatCount,
  formatRate,
  languageName,
  pageName,
  utmParts,
} from './analytics-labels'

describe('A10 の数の書き方', () => {
  it('件数は桁区切り', () => {
    expect(formatCount(1234567)).toBe('1,234,567')
    expect(formatCount(0)).toBe('0')
  })

  it('前の期間との差は符号付きの百分率。前が0なら —', () => {
    expect(formatChange(0.12)).toBe('+12%')
    expect(formatChange(-0.054)).toBe('−5%')
    expect(formatChange(0.001)).toBe('±0%')
    expect(formatChange(null)).toBe('—')
  })

  it('割合', () => {
    expect(formatRate(0.716)).toBe('72%')
    expect(formatRate(null)).toBe('—')
  })
})

describe('A10 の名前', () => {
  it('国の名前。XX は不明、名前の無いコードはそのまま', () => {
    expect(countryName('JP')).toBe('日本')
    expect(countryName('XX')).toBe('不明')
    expect(countryName('T1')).toBe('T1')
  })

  it('ブラウザの言語の名前。(unknown) は不明', () => {
    expect(languageName('ja')).toBe('日本語')
    expect(languageName('(unknown)')).toBe('不明')
  })

  it('ページの名前は種類の名前とタイトル（日本語、なければ英語）。タイトルが無ければ null', () => {
    expect(pageName('/ja/works/my-app', { ja: 'マイアプリ', en: 'My App' })).toBe('Lab: マイアプリ')
    expect(pageName('/en/blog/hello', { ja: null, en: 'Hello' })).toBe('Blog: Hello')
    expect(pageName('/ja/coding/x', { ja: '記録', en: null })).toBe('Coding Log: 記録')
    expect(pageName('/ja', null)).toBeNull()
  })

  it('UTM のキーを source・medium・campaign に分ける', () => {
    expect(utmParts('linkedin|social|')).toEqual(['linkedin', 'social', ''])
  })
})

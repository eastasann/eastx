import { describe, expect, it } from 'vitest'
import { availabilityOf, pickText } from './localize'

describe('availabilityOf', () => {
  it('表示中の言語で言語ありなら、その言語で代替しない', () => {
    expect(availabilityOf('title', 'ja', { ja: { title: '作品' }, en: { title: 'Work' } })).toEqual({
      lang: 'ja',
      fallback: false,
    })
  })

  it('表示中の言語で言語ありでなければ、もう片方の言語で出して代替の印を付ける', () => {
    expect(availabilityOf('title', 'ja', { ja: { title: null }, en: { title: 'Work' } })).toEqual({
      lang: 'en',
      fallback: true,
    })
  })

  it('ブログ・コーディング記録はタイトルと本文の両方で判定する', () => {
    const fields = { ja: { title: 'タイトル', body: null }, en: { title: 'Title', body: 'Body' } }
    expect(availabilityOf('titleAndBody', 'ja', fields)).toEqual({ lang: 'en', fallback: true })
  })

  it('どちらの言語も言語ありでなければ、表示中の言語のまま', () => {
    expect(availabilityOf('title', 'en', { ja: { title: ' ' }, en: { title: null } })).toEqual({
      lang: 'en',
      fallback: false,
    })
  })
})

describe('pickText', () => {
  it('出す言語の値があればそれを使う', () => {
    expect(pickText('ja', { ja: '東京', en: 'Tokyo' })).toEqual({ value: '東京', lang: 'ja' })
  })

  it('出す言語の値が空なら、その項目だけもう片方の言語の値を使う', () => {
    expect(pickText('en', { ja: '東京', en: null })).toEqual({ value: '東京', lang: 'ja' })
  })

  it('どちらも空なら項目ごと出さない', () => {
    expect(pickText('ja', { ja: null, en: '' })).toBeNull()
  })
})

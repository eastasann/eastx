import { describe, expect, it } from 'vitest'
import { browserLanguageOf, countryOf, referrerHostOf, toDataPoint, utmKeyOf } from './data-point'

const facts = {
  visitor: 'f'.repeat(32),
  country: 'JP',
  device: 'mobile',
  browserLanguage: 'ja',
  siteHost: 'x.eastasian.dev',
}

describe('browserLanguageOf', () => {
  it('q 値で最優先の言語タグの主の部分を英小文字で', () => {
    expect(browserLanguageOf('en-US,en;q=0.9,ja;q=0.8')).toBe('en')
    expect(browserLanguageOf('ja;q=0.5, zh-Hant-TW;q=0.9')).toBe('zh')
    expect(browserLanguageOf('JA-jp')).toBe('ja')
  })

  it('無い・読めない値は空', () => {
    expect(browserLanguageOf(null)).toBe('')
    expect(browserLanguageOf('*')).toBe('')
    expect(browserLanguageOf('1234')).toBe('')
  })
})

describe('countryOf', () => {
  it('2文字のコードはそのまま、無い・形の違うものは XX', () => {
    expect(countryOf('JP')).toBe('JP')
    expect(countryOf('T1')).toBe('T1')
    expect(countryOf(undefined)).toBe('XX')
    expect(countryOf('jp')).toBe('XX')
    expect(countryOf(81)).toBe('XX')
  })
})

describe('referrerHostOf', () => {
  it('ホスト名だけを残し、パスとクエリは捨てる', () => {
    expect(referrerHostOf('https://www.LinkedIn.com/feed/?trk=1', facts.siteHost)).toBe('www.linkedin.com')
  })

  it('ホスト名の形でないもの（予約のキー (other)・IPv6）は空。末尾の点は除く', () => {
    expect(referrerHostOf('http://(other)/', facts.siteHost)).toBe('')
    expect(referrerHostOf('http://[::1]/', facts.siteHost)).toBe('')
    expect(referrerHostOf('https://www.google.com./', facts.siteHost)).toBe('www.google.com')
    expect(referrerHostOf('https://x.eastasian.dev./ja', facts.siteHost)).toBe('')
  })

  it('自分のサイトからの移動と、無い・空の流入元は空', () => {
    expect(referrerHostOf('https://x.eastasian.dev/ja', facts.siteHost)).toBe('')
    expect(referrerHostOf(undefined, facts.siteHost)).toBe('')
    expect(referrerHostOf('', facts.siteHost)).toBe('')
  })
})

describe('utmKeyOf', () => {
  it('source|medium|campaign。無いものは空、全部無ければ空', () => {
    expect(utmKeyOf({ source: 'linkedin', medium: 'social', campaign: null })).toBe('linkedin|social|')
    expect(utmKeyOf({ source: null, medium: null, campaign: 'fall' })).toBe('||fall')
    expect(utmKeyOf({ source: null, medium: null, campaign: null })).toBe('')
    expect(utmKeyOf(undefined)).toBe('')
  })
})

describe('toDataPoint（SDD 5.14 の表）', () => {
  it('page_view は流入元と UTM を入れ、14個の blob をそろえる', () => {
    const point = toDataPoint(
      {
        type: 'page_view',
        path: '/ja/works/my-app',
        lang: 'ja',
        referrer: 'https://www.linkedin.com/feed/',
        utm: { source: 'linkedin', medium: 'social', campaign: null },
      },
      facts,
    )
    expect(point).toEqual({
      indexes: [facts.visitor],
      blobs: [
        'page_view',
        '/ja/works/my-app',
        'ja',
        'www.linkedin.com',
        'linkedin|social|',
        'JP',
        'mobile',
        'ja',
        '',
        '',
        '',
        '',
        '',
        facts.visitor,
      ],
      doubles: [0],
    })
  })

  it('種類ごとの固有の値の位置', () => {
    const common = { path: '/ja', lang: 'ja' as const }
    expect(toDataPoint({ type: 'section_view', ...common, section: 'career' }, facts).blobs[8]).toBe('career')
    const expand = toDataPoint({ type: 'row_expand', ...common, section: 'works', itemId: 'id-1' }, facts)
    expect([expand.blobs[8], expand.blobs[9]]).toEqual(['works', 'id-1'])
    const paging = toDataPoint({ type: 'paging', ...common, section: 'blog', page: 3 }, facts)
    expect([paging.blobs[8], paging.doubles[0]]).toEqual(['blog', 3])
    const outbound = toDataPoint({ type: 'outbound', ...common, linkKind: 'github', host: 'github.com' }, facts)
    expect([outbound.blobs[10], outbound.blobs[11]]).toEqual(['github', 'github.com'])
    expect(toDataPoint({ type: 'lang_switch', ...common, to: 'en' }, facts).blobs[12]).toBe('en')
    expect(toDataPoint({ type: 'theme_switch', ...common, to: 'dark' }, facts).blobs[12]).toBe('dark')
    const copy = toDataPoint({ type: 'code_copy', ...common }, facts)
    expect(copy.blobs.slice(8, 13)).toEqual(['', '', '', '', ''])
    expect(toDataPoint({ type: 'read_complete', ...common }, facts).blobs).toHaveLength(14)
  })
})

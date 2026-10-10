import { describe, expect, it } from 'vitest'
import { isHostname, parseEvent } from './events'

const send = (body: unknown) => parseEvent(JSON.stringify(body))
const common = { path: '/ja', lang: 'ja' }
const ITEM_ID = 'a7e3c1d2-5b7d-4c1e-9a3f-2d6b8e4f1a07'

describe('parseEvent（SDD 5.14 の値の検査）', () => {
  it('種類ごとの正しい本文を受け付ける', () => {
    expect(send({ type: 'page_view', ...common })).toEqual({ type: 'page_view', ...common })
    expect(send({ type: 'section_view', ...common, section: 'stack' })).toMatchObject({ section: 'stack' })
    expect(send({ type: 'read_complete', path: '/en/blog/hello', lang: 'en' })).toMatchObject({
      type: 'read_complete',
    })
    expect(send({ type: 'row_expand', ...common, section: 'works', itemId: ITEM_ID })).toMatchObject({
      itemId: ITEM_ID,
    })
    expect(send({ type: 'paging', ...common, section: 'blog', page: 2 })).toMatchObject({ page: 2 })
    expect(send({ type: 'outbound', ...common, linkKind: 'github', host: 'GitHub.com' })).toMatchObject({
      host: 'github.com',
    })
    expect(send({ type: 'lang_switch', ...common, to: 'en' })).toMatchObject({ to: 'en' })
    expect(send({ type: 'theme_switch', ...common, to: 'dark' })).toMatchObject({ to: 'dark' })
    expect(send({ type: 'code_copy', ...common })).toMatchObject({ type: 'code_copy' })
  })

  it('page_view の referrer と utm は省ける。utm は前後の空白を除いて英小文字にする', () => {
    expect(
      send({
        type: 'page_view',
        ...common,
        referrer: 'https://www.linkedin.com/feed/',
        utm: { source: ' LinkedIn ', medium: 'Social', campaign: null },
      }),
    ).toEqual({
      type: 'page_view',
      ...common,
      referrer: 'https://www.linkedin.com/feed/',
      utm: { source: 'linkedin', medium: 'social', campaign: null },
    })
    expect(send({ type: 'page_view', ...common, referrer: '' })).toMatchObject({ referrer: '' })
    expect(send({ type: 'page_view', ...common, utm: { source: '  ' } })).toMatchObject({
      utm: { source: null, medium: null, campaign: null },
    })
  })

  it('JSON でない・オブジェクトでない・種類の無い本文は受け付けない', () => {
    expect(parseEvent('not json')).toBeNull()
    expect(parseEvent('[]')).toBeNull()
    expect(parseEvent('null')).toBeNull()
    expect(send({ ...common })).toBeNull()
    expect(send({ type: 'click', ...common })).toBeNull()
  })

  it('種類ごとに決めたキーだけを受け付ける（余分なキー・足りないキー）', () => {
    expect(send({ type: 'page_view', ...common, section: 'career' })).toBeNull()
    expect(send({ type: 'code_copy', ...common, referrer: '' })).toBeNull()
    expect(send({ type: 'row_expand', ...common, section: 'works' })).toBeNull()
    expect(send({ type: 'paging', ...common, page: 2 })).toBeNull()
    expect(send({ type: 'page_view', lang: 'ja' })).toBeNull()
    expect(send({ type: 'page_view', path: '/ja' })).toBeNull()
  })

  it('path は / で始まり300字まで。公開側のルートに当たらないものも受け付ける', () => {
    expect(send({ type: 'page_view', ...common, path: '/fr/foo' })).toMatchObject({ path: '/fr/foo' })
    expect(send({ type: 'page_view', ...common, path: `/${'a'.repeat(299)}` })).not.toBeNull()
    expect(send({ type: 'page_view', ...common, path: `/${'a'.repeat(300)}` })).toBeNull()
    expect(send({ type: 'page_view', ...common, path: 'ja' })).toBeNull()
    expect(send({ type: 'page_view', ...common, path: 1 })).toBeNull()
  })

  it('lang は ja・en だけ', () => {
    expect(send({ type: 'page_view', ...common, lang: 'fr' })).toBeNull()
  })

  it('referrer のホスト名の形は問わない（記録するときに空にする。閲覧は数える）', () => {
    expect(send({ type: 'page_view', ...common, referrer: 'http://(other)/' })).not.toBeNull()
    expect(send({ type: 'page_view', ...common, referrer: 'http://[::1]/' })).not.toBeNull()
  })

  it('path が // で始まる・\\ を含むものは受け付けない（別のホストの URL として読まれる）', () => {
    expect(send({ type: 'page_view', ...common, path: '//evil.example/x' })).toBeNull()
    expect(send({ type: 'page_view', ...common, path: '/\\evil.example' })).toBeNull()
  })

  it('referrer は http・https の URL か空で、2,048字まで', () => {
    expect(send({ type: 'page_view', ...common, referrer: 'http://example.com/' })).not.toBeNull()
    expect(send({ type: 'page_view', ...common, referrer: 'javascript:alert(1)' })).toBeNull()
    expect(send({ type: 'page_view', ...common, referrer: 'not a url' })).toBeNull()
    expect(send({ type: 'page_view', ...common, referrer: `https://e.com/${'a'.repeat(2048)}` })).toBeNull()
    expect(send({ type: 'page_view', ...common, referrer: null })).toBeNull()
  })

  it('utm の値は文字列か null で100字まで。| を含むもの・ほかのキーは受け付けない', () => {
    expect(send({ type: 'page_view', ...common, utm: { source: 'a'.repeat(100) } })).not.toBeNull()
    expect(send({ type: 'page_view', ...common, utm: { source: 'a'.repeat(101) } })).toBeNull()
    expect(send({ type: 'page_view', ...common, utm: { source: 'a|b' } })).toBeNull()
    expect(send({ type: 'page_view', ...common, utm: { term: 'x' } })).toBeNull()
    expect(send({ type: 'page_view', ...common, utm: { source: 1 } })).toBeNull()
    expect(send({ type: 'page_view', ...common, utm: 'linkedin' })).toBeNull()
  })

  it('section は種類ごとの一覧の値だけ', () => {
    expect(send({ type: 'section_view', ...common, section: 'profile' })).not.toBeNull()
    expect(send({ type: 'section_view', ...common, section: 'footer' })).toBeNull()
    expect(send({ type: 'row_expand', ...common, section: 'blog', itemId: ITEM_ID })).toBeNull()
    expect(send({ type: 'paging', ...common, section: 'stack', page: 2 })).toBeNull()
  })

  it('itemId は UUID の形', () => {
    expect(send({ type: 'row_expand', ...common, section: 'career', itemId: 'not-a-uuid' })).toBeNull()
    expect(send({ type: 'row_expand', ...common, section: 'career', itemId: ITEM_ID.toUpperCase() })).toMatchObject({
      itemId: ITEM_ID,
    })
  })

  it('page は 1〜1000 の整数', () => {
    expect(send({ type: 'paging', ...common, section: 'works', page: 1000 })).not.toBeNull()
    expect(send({ type: 'paging', ...common, section: 'works', page: 0 })).toBeNull()
    expect(send({ type: 'paging', ...common, section: 'works', page: 1001 })).toBeNull()
    expect(send({ type: 'paging', ...common, section: 'works', page: 1.5 })).toBeNull()
    expect(send({ type: 'paging', ...common, section: 'works', page: '2' })).toBeNull()
  })

  it('linkKind は一覧の値、host はホスト名の形', () => {
    expect(send({ type: 'outbound', ...common, linkKind: 'mail', host: 'example.com' })).toBeNull()
    expect(send({ type: 'outbound', ...common, linkKind: 'body', host: 'exa mple.com' })).toBeNull()
  })

  it('to は種類ごとの値だけ', () => {
    expect(send({ type: 'lang_switch', ...common, to: 'dark' })).toBeNull()
    expect(send({ type: 'theme_switch', ...common, to: 'ja' })).toBeNull()
  })
})

describe('isHostname', () => {
  it('ラベルを点でつないだ253字までの名前', () => {
    expect(isHostname('github.com')).toBe(true)
    expect(isHostname('localhost')).toBe(true)
    expect(isHostname('192.0.2.1')).toBe(true)
    expect(isHostname('')).toBe(false)
    expect(isHostname('-a.com')).toBe(false)
    expect(isHostname('a..com')).toBe(false)
    expect(isHostname(`${'a'.repeat(64)}.com`)).toBe(false)
    expect(isHostname(Array(64).fill('abc').join('.'))).toBe(false)
    expect(isHostname(1)).toBe(false)
  })
})

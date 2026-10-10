/**
 * Analytics Engine の1件（SDD 5.14 の表）。blob の位置は集計の問い合わせ（src/api/analytics/queries.ts）と対になる
 */
import { primaryLanguageTag } from '../../i18n/detect'
import { type AnalyticsEvent, isHostname, type Utm } from './events'

/** ブラウザの言語として残す、言語タグの主の部分の形 */
const LANGUAGE_SUBTAG = /^[a-z]{2,8}$/

/** `Accept-Language` の q 値で最優先の言語タグの主の部分（`ja-JP` → `ja`）。無い・読めなければ空 */
export function browserLanguageOf(acceptLanguage: string | null): string {
  const primary = primaryLanguageTag(acceptLanguage)?.split('-')[0]?.toLowerCase() ?? ''
  return LANGUAGE_SUBTAG.test(primary) ? primary : ''
}

/** 国のコード（Cloudflare の `request.cf.country`）。無い・形の違うものは `XX`（不明） */
export function countryOf(country: unknown): string {
  return typeof country === 'string' && /^[A-Z0-9]{2}$/.test(country) ? country : 'XX'
}

/**
 * 流入元のホスト名。パスとクエリは捨て、自分のサイト（`siteHost`）からの移動は空にする。末尾の点（`example.com.`）は除く。
 * ホスト名の形でないもの（`http://(other)/` のように集計の予約のキー `(other)` になる値、IPv6 のアドレス）は空にする。
 * 閲覧そのものは数える
 */
export function referrerHostOf(referrer: string | undefined, siteHost: string): string {
  if (referrer === undefined || referrer === '') return ''
  const host = new URL(referrer).hostname.toLowerCase().replace(/\.$/, '')
  if (!isHostname(host)) return ''
  return host === siteHost.toLowerCase() ? '' : host
}

/** `source|medium|campaign`。無いものは空にし、全部無ければ空 */
export function utmKeyOf(utm: Utm | undefined): string {
  if (utm === undefined) return ''
  const { source, medium, campaign } = utm
  if (source === null && medium === null && campaign === null) return ''
  return [source ?? '', medium ?? '', campaign ?? ''].join('|')
}

export interface RequestFacts {
  visitor: string
  country: string
  device: string
  browserLanguage: string
  /** `SITE_URL` のホスト名 */
  siteHost: string
}

export interface DataPoint {
  indexes: [string]
  blobs: string[]
  doubles: [number]
}

/** 値の無い blob も空文字で書き、14個をそろえる（SQL の `blob4 != ''` が書いた値どおりに当たるように） */
export function toDataPoint(event: AnalyticsEvent, facts: RequestFacts): DataPoint {
  const blobs = Array<string>(14).fill('')
  blobs[0] = event.type
  blobs[1] = event.path
  blobs[2] = event.lang
  blobs[5] = facts.country
  blobs[6] = facts.device
  blobs[7] = facts.browserLanguage
  blobs[13] = facts.visitor
  let page = 0
  switch (event.type) {
    case 'page_view':
      blobs[3] = referrerHostOf(event.referrer, facts.siteHost)
      blobs[4] = utmKeyOf(event.utm)
      break
    case 'section_view':
      blobs[8] = event.section
      break
    case 'row_expand':
      blobs[8] = event.section
      blobs[9] = event.itemId
      break
    case 'paging':
      blobs[8] = event.section
      page = event.page
      break
    case 'outbound':
      blobs[10] = event.linkKind
      blobs[11] = event.host
      break
    case 'lang_switch':
    case 'theme_switch':
      blobs[12] = event.to
      break
    case 'read_complete':
    case 'code_copy':
      break
  }
  return { indexes: [facts.visitor], blobs, doubles: [page] }
}

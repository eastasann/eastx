/**
 * 解析のイベントの形と値の検査（SDD 5.14）。受け口（src/api/collect.ts）が使い、公開側の送信の部品
 * （src/site/analytics.ts）は名前の定数だけを読む。Zod を公開側のバンドルに入れないため、検査は手で書く
 */
import { LANGS, type Lang } from '../../i18n/detect'

export const EVENT_TYPES = [
  'page_view',
  'section_view',
  'read_complete',
  'row_expand',
  'paging',
  'outbound',
  'lang_switch',
  'theme_switch',
  'code_copy',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

/** P1 のセクション。並びは SDD 4.1 のトップのセクションの要素の ID の順 */
export const TOP_SECTIONS = ['profile', 'career', 'projects', 'works', 'stack', 'blog', 'coding'] as const
export type TopSection = (typeof TOP_SECTIONS)[number]
/** 行を広げられるセクション */
export const EXPANDABLE_SECTIONS = ['career', 'projects', 'works'] as const
export type ExpandableSection = (typeof EXPANDABLE_SECTIONS)[number]
/** セクション内ページングを持つセクション */
export const PAGED_SECTIONS = ['career', 'projects', 'works', 'blog', 'coding'] as const
export type PagedSectionName = (typeof PAGED_SECTIONS)[number]

/** 外部リンクの種類。`body` は Markdown の本文のリンク（属性を持たない） */
export const LINK_KINDS = ['site', 'github', 'social', 'stack', 'reference', 'body'] as const
export type LinkKind = (typeof LINK_KINDS)[number]

export const THEME_CHOICES = ['system', 'light', 'dark'] as const
export type ThemeChoice = (typeof THEME_CHOICES)[number]

/** 本文の上限（バイト） */
export const MAX_EVENT_BYTES = 4096
const PATH_MAX = 300
const REFERRER_MAX = 2048
const UTM_MAX = 100
const HOST_MAX = 253
const PAGE_MAX = 1000

export interface Utm {
  source: string | null
  medium: string | null
  campaign: string | null
}

interface Common {
  path: string
  lang: Lang
}

/** 検査を通ったイベント。`utm` の値は前後の空白を除いて英小文字にしてある */
export type AnalyticsEvent = Common &
  (
    | { type: 'page_view'; referrer?: string; utm?: Utm }
    | { type: 'section_view'; section: TopSection }
    | { type: 'read_complete' }
    | { type: 'row_expand'; section: ExpandableSection; itemId: string }
    | { type: 'paging'; section: PagedSectionName; page: number }
    | { type: 'outbound'; linkKind: LinkKind; host: string }
    | { type: 'lang_switch'; to: Lang }
    | { type: 'theme_switch'; to: ThemeChoice }
    | { type: 'code_copy' }
  )

/** `type` ごとに受け付けるキー。共通の `type`・`path`・`lang` のほかに、必須と省けるものを分ける */
const KEYS: Record<EventType, { required: readonly string[]; optional: readonly string[] }> = {
  page_view: { required: [], optional: ['referrer', 'utm'] },
  section_view: { required: ['section'], optional: [] },
  read_complete: { required: [], optional: [] },
  row_expand: { required: ['section', 'itemId'], optional: [] },
  paging: { required: ['section', 'page'], optional: [] },
  outbound: { required: ['linkKind', 'host'], optional: [] },
  lang_switch: { required: ['to'], optional: [] },
  theme_switch: { required: ['to'], optional: [] },
  code_copy: { required: [], optional: [] },
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HOST_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `http:`・`https:` の URL か空文字。記録するホスト名の形は data-point.ts の referrerHostOf が見る */
function isReferrer(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > REFERRER_MAX) return false
  if (value === '') return true
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export function isHostname(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.length > HOST_MAX) return false
  return value.split('.').every((label) => label.length <= 63 && HOST_LABEL.test(label))
}

/** UTM の値。`|` は記録の区切り（`source|medium|campaign`）に使うので受け付けない */
function utmValue(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || value.length > UTM_MAX || value.includes('|')) return undefined
  const normalized = value.trim().toLowerCase()
  return normalized === '' ? null : normalized
}

function parseUtm(value: unknown): Utm | undefined {
  if (!isRecord(value)) return undefined
  if (Object.keys(value).some((key) => key !== 'source' && key !== 'medium' && key !== 'campaign')) return undefined
  const source = utmValue(value.source)
  const medium = utmValue(value.medium)
  const campaign = utmValue(value.campaign)
  if (source === undefined || medium === undefined || campaign === undefined) return undefined
  return { source, medium, campaign }
}

/**
 * 受け口が受け取った本文の文字列を検査する。形・キー・値のどれかが違えば null（400）。
 * 大きさ（MAX_EVENT_BYTES）は読み込みの側で止める
 */
export function parseEvent(text: string): AnalyticsEvent | null {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(body) || !oneOf(EVENT_TYPES, body.type)) return null
  const { type, path, lang } = body
  const { required, optional } = KEYS[type]
  const allowed = new Set(['type', 'path', 'lang', ...required, ...optional])
  if (Object.keys(body).some((key) => !allowed.has(key))) return null
  if (required.some((key) => !(key in body))) return null
  // `//host` と `\` は、ブラウザが別のホストの URL として読む（A10 はパスを公開サイトへのリンクにする）
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null
  if (path.length > PATH_MAX) return null
  if (!oneOf(LANGS, lang)) return null
  const common = { path, lang }

  switch (type) {
    case 'page_view': {
      const event: AnalyticsEvent = { type, ...common }
      if ('referrer' in body) {
        if (!isReferrer(body.referrer)) return null
        event.referrer = body.referrer
      }
      if ('utm' in body) {
        const utm = parseUtm(body.utm)
        if (utm === undefined) return null
        event.utm = utm
      }
      return event
    }
    case 'section_view':
      return oneOf(TOP_SECTIONS, body.section) ? { type, ...common, section: body.section } : null
    case 'row_expand':
      return oneOf(EXPANDABLE_SECTIONS, body.section) &&
        typeof body.itemId === 'string' &&
        UUID_PATTERN.test(body.itemId)
        ? { type, ...common, section: body.section, itemId: body.itemId.toLowerCase() }
        : null
    case 'paging':
      return oneOf(PAGED_SECTIONS, body.section) &&
        Number.isInteger(body.page) &&
        (body.page as number) >= 1 &&
        (body.page as number) <= PAGE_MAX
        ? { type, ...common, section: body.section, page: body.page as number }
        : null
    case 'outbound':
      return oneOf(LINK_KINDS, body.linkKind) && isHostname(body.host)
        ? { type, ...common, linkKind: body.linkKind, host: body.host.toLowerCase() }
        : null
    case 'lang_switch':
      return oneOf(LANGS, body.to) ? { type, ...common, to: body.to } : null
    case 'theme_switch':
      return oneOf(THEME_CHOICES, body.to) ? { type, ...common, to: body.to } : null
    case 'read_complete':
    case 'code_copy':
      return { type, ...common }
  }
}

/**
 * ローカル用のデモの解析の集計（design-spec 8章）。シードを流した日（日本時間）の前日までの400日ぶんを、
 * Cron が書いたのと同じ形（SDD 6.3 の analytics_daily・analytics_rollup）で作る。
 * 値は日付から決まる擬似乱数で作り、同じ日に流せば同じ値になる。3日前は集計していない日として抜く（A10 の missingDays）
 */
import type { analyticsDaily, analyticsRollup } from '../../src/db/schema'
import { DEVICES } from '../../src/domain/analytics/bots'
import { addDays, datesBetween } from '../../src/domain/analytics/dates'

export const DEMO_ANALYTICS_DAYS = 400
/** 集計していない日（今日からの日数） */
export const DEMO_MISSING_DAYS_AGO = 3

type DailyRow = typeof analyticsDaily.$inferInsert
type RollupRow = typeof analyticsRollup.$inferInsert
type Dimension = DailyRow['dimension']

/** 日付の文字列から作る、再現できる擬似乱数（mulberry32） */
function randomFor(date: string): () => number {
  let state = [...date].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619), 2166136261) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface DemoAnalyticsInput {
  /** シードを流した日（日本時間） */
  today: string
  /** 広げた行のデモに使う、公開中の作品・プロジェクトの ID */
  rowItems: { section: 'works' | 'projects'; id: string }[]
}

const PAGES = [
  '/ja',
  '/en',
  '/ja/works/portfolio-cms',
  '/en/works/portfolio-cms',
  '/ja/works/task-board',
  '/ja/projects/payment-renewal',
  '/ja/blog/hello-eastx',
  '/en/blog/hello-eastx',
  '/ja/blog/d1-batch',
  '/ja/coding/learn-elysia',
]
const REFERRERS = ['www.google.com', 'www.linkedin.com', 'github.com', 't.co', 'zenn.dev']
const UTMS = ['linkedin|social|', 'newsletter|email|fall-2026']
const COUNTRIES = ['JP', 'US', 'PH', 'XX']
const BROWSER_LANGS = ['ja', 'en', 'zh']
const SECTIONS = ['profile', 'career', 'projects', 'works', 'stack', 'blog', 'coding']
const READ_PAGES = PAGES.slice(2, 7)
const PAGING = ['works', 'blog', 'coding']
const OUTBOUNDS = [
  'site:example.com',
  'github:github.com',
  'social:www.linkedin.com',
  'stack:react.dev',
  'reference:developer.mozilla.org',
  'body:developer.cloudflare.com',
]
const CODE_PAGES = ['/ja/coding/learn-elysia', '/ja/coding/snippet-add']

export function buildDemoAnalytics(input: DemoAnalyticsInput): { daily: DailyRow[]; rollup: RollupRow[] } {
  const yesterday = addDays(input.today, -1)
  const missing = addDays(input.today, -DEMO_MISSING_DAYS_AGO)
  const dates = datesBetween(addDays(input.today, -DEMO_ANALYTICS_DAYS), yesterday).filter((date) => date !== missing)
  const daily: DailyRow[] = []
  for (const date of dates) {
    const random = randomFor(date)
    const between = (min: number, max: number) => min + Math.floor(random() * (max - min + 1))
    const push = (dimension: Dimension, key: string, count: number, ratio = 0.6) => {
      if (count <= 0) return
      daily.push({ date, dimension, key, count, visitors: Math.max(1, Math.min(count, Math.round(count * ratio))) })
    }
    // 1日の閲覧の目安。週末は少なく、日ごとに揺らす
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
    const base = between(20, 60) - (weekday === 0 || weekday === 6 ? 10 : 0)
    const pages = PAGES.map((path, i) => ({ path, count: Math.max(1, Math.round(base / (i + 2)) + between(1, 3)) }))
    const pageViews = pages.reduce((sum, page) => sum + page.count, 0)
    push('total', '', pageViews, 0.45)
    for (const page of pages) push('page', page.path, page.count)
    const top = (pages[0]?.count ?? 0) + (pages[1]?.count ?? 0)
    const topVisitors = Math.max(1, Math.round(top * 0.6))
    push('top_view', '', top)
    REFERRERS.forEach((host, i) => {
      push('referrer', host, between(1, 6 - i))
    })
    UTMS.forEach((key) => {
      push('utm', key, between(1, 2))
    })
    COUNTRIES.forEach((code, i) => {
      push('country', code, Math.round(pageViews / (i + 1.5)))
    })
    DEVICES.forEach((device, i) => {
      push('device', device, Math.round(pageViews / (i + 1.6)))
    })
    BROWSER_LANGS.forEach((lang, i) => {
      push('browser_lang', lang, Math.round(pageViews / (i + 1.7)))
    })
    push('site_lang', 'ja', Math.round(pageViews * 0.7))
    push('site_lang', 'en', Math.round(pageViews * 0.3))
    // 到達率は下のセクションほど下がる（分母は top_view の訪問者）
    SECTIONS.forEach((section, i) => {
      const reached = Math.max(1, Math.round(topVisitors * (1 - i * 0.11)))
      push('section_view', section, reached, 1)
    })
    READ_PAGES.forEach((path, i) => {
      push('read_complete', path, between(1, 4 - Math.min(i, 3)))
    })
    input.rowItems.slice(0, 5).forEach((item, i) => {
      push('row_expand', `${item.section}:${item.id}`, between(1, 5 - i))
    })
    PAGING.forEach((section) => {
      push('paging', section, between(1, 3))
    })
    let outbound = 0
    OUTBOUNDS.forEach((key, i) => {
      const count = between(1, 4 - Math.min(i, 3))
      outbound += count
      push('outbound', key, count)
    })
    push('outbound_total', '', outbound)
    push('lang_switch', 'en', between(1, 3))
    push('lang_switch', 'ja', 1)
    push('theme_switch', 'dark', between(1, 2))
    push('theme_switch', 'light', 1)
    push('theme_switch', 'system', 1)
    CODE_PAGES.forEach((path) => {
      push('code_copy', path, between(1, 2))
    })
  }
  const rolledUpAt = new Date(`${yesterday}T15:15:00Z`)
  return { daily, rollup: dates.map((date) => ({ date, rolledUpAt })) }
}

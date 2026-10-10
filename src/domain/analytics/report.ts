/**
 * A10 の期間と集計の規則（SDD 5.13）。期間・前の期間・区切り・集計していない日の数と、日ごとの行の合計の仕方
 */
import { addDays, datesBetween, dayCount, monthStartOf, weekdayOf } from './dates'
import { byCountDesc, type KeyCount, OTHER_KEY } from './rollup'

export const ANALYTICS_RANGES = ['7d', '30d', '90d', '1y', 'all'] as const
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number]
export const BUCKETS = ['day', 'week', 'month'] as const
export type Bucket = (typeof BUCKETS)[number]

const RANGE_DAYS: Record<Exclude<AnalyticsRange, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 }
/** A10 の一覧に出す件数 */
export const LIST_LIMIT = 10

export interface Period {
  from: string
  to: string
}

/**
 * 期間。日本時間の今日を含む N 日。`all` は計測の開始日から今日まで（開始日が無い・今日より後なら今日だけ）
 */
export function periodOf(range: AnalyticsRange, today: string, startDate: string | null): Period {
  if (range === 'all') return { from: startDate !== null && startDate < today ? startDate : today, to: today }
  return { from: addDays(today, -(RANGE_DAYS[range] - 1)), to: today }
}

/**
 * 同じ長さの直前の期間。`all`、開始日が無い、直前の期間が開始日より前に始まる（データが足りない）ときは null
 */
export function previousPeriodOf(range: AnalyticsRange, period: Period, startDate: string | null): Period | null {
  if (range === 'all' || startDate === null) return null
  const length = dayCount(period.from, period.to)
  const previous = { from: addDays(period.from, -length), to: addDays(period.from, -1) }
  return previous.from < startDate ? null : previous
}

export function bucketOf(range: AnalyticsRange): Bucket {
  if (range === '1y') return 'week'
  if (range === 'all') return 'month'
  return 'day'
}

/**
 * 区切りの最初の日（古い順）。週は月曜始まり、月は1日始まりで、最初の区切りは期間の最初の日から始まる
 */
export function bucketStarts(bucket: Bucket, period: Period): string[] {
  const dates = datesBetween(period.from, period.to)
  if (bucket === 'day') return dates
  return dates.filter(
    (date, index) => index === 0 || (bucket === 'week' ? weekdayOf(date) === 1 : monthStartOf(date) === date),
  )
}

/** その日が入る区切りの位置。`starts` は bucketStarts の結果で、`date` は期間の中 */
export function bucketIndexOf(starts: readonly string[], date: string): number {
  let index = 0
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i]
    if (start !== undefined && start <= date) index = i
  }
  return index
}

/**
 * 期間の中で、計測の開始日から昨日までのうち集計していない日の数。開始日より前の日と今日は数えない。開始日が無ければ0
 */
export function missingDaysOf(input: {
  period: Period
  today: string
  startDate: string | null
  rolledUp: ReadonlySet<string>
}): number {
  const { period, today, startDate, rolledUp } = input
  if (startDate === null) return 0
  const from = period.from > startDate ? period.from : startDate
  const yesterday = addDays(today, -1)
  const to = period.to < yesterday ? period.to : yesterday
  return datesBetween(from, to).filter((date) => !rolledUp.has(date)).length
}

/** 同じキーの行を合計する（日ごとの行を期間でまとめる）。`(other)` は除く */
export function sumByKey(rows: readonly KeyCount[]): KeyCount[] {
  const totals = new Map<string, KeyCount>()
  for (const row of rows) {
    if (row.key === OTHER_KEY) continue
    const total = totals.get(row.key) ?? { key: row.key, count: 0, visitors: 0 }
    total.count += row.count
    total.visitors += row.visitors
    totals.set(row.key, total)
  }
  return [...totals.values()]
}

/** 期間で合計し、件数の多い順に上位 LIST_LIMIT 件 */
export function topKeysOf(rows: readonly KeyCount[], limit = LIST_LIMIT): KeyCount[] {
  return sumByKey(rows).sort(byCountDesc).slice(0, limit)
}

/** 件数と訪問者数の合計 */
export function totalOf(rows: readonly KeyCount[]): { count: number; visitors: number } {
  return rows.reduce((sum, row) => ({ count: sum.count + row.count, visitors: sum.visitors + row.visitors }), {
    count: 0,
    visitors: 0,
  })
}

/** P1 のセクション到達率。分母（P1 の訪問者数）が0なら null */
export function reachRateOf(sectionVisitors: number, topVisitors: number): number | null {
  return topVisitors === 0 ? null : sectionVisitors / topVisitors
}

/** 前の期間との差の割合（`+12%` の 0.12）。前が0なら null（A10 は「—」） */
export function changeRateOf(current: number, previous: number): number | null {
  return previous === 0 ? null : (current - previous) / previous
}

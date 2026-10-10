/**
 * A10 の集計（SDD 5.13）と A2 の要約（5.4）。確定した日は D1 の analytics_daily、今日の分は SQL API から読んで足す。
 * 期間・区切り・上位の規則は src/domain/analytics/report.ts
 */
import { and, asc, gte, inArray, lte, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { Db } from '../../db/client'
import { analyticsDaily, analyticsRollup, blogPost, career, codingLog, project, work } from '../../db/schema'
import { addDays, jstDateOf } from '../../domain/analytics/dates'
import {
  EXPANDABLE_SECTIONS,
  type ExpandableSection,
  LINK_KINDS,
  type LinkKind,
  PAGED_SECTIONS,
  THEME_CHOICES,
  TOP_SECTIONS,
} from '../../domain/analytics/events'
import {
  type AnalyticsRange,
  bucketIndexOf,
  bucketOf,
  bucketStarts,
  missingDaysOf,
  type Period,
  periodOf,
  previousPeriodOf,
  reachRateOf,
  sumByKey,
  topKeysOf,
  totalOf,
} from '../../domain/analytics/report'
import type { KeyCount } from '../../domain/analytics/rollup'
import type { analyticsOutput } from '../contract/analytics'
import { log } from '../log'
import { type AnalyticsDimension, queryDailyRows } from './queries'
import type { SqlApiConfig } from './sql'

type AnalyticsOutput = z.infer<typeof analyticsOutput>
type Title = { ja: string | null; en: string | null } | null

/** 今日の分を待つ時間。外部の API の遅さで A10 の表示を止めない */
const TODAY_TIMEOUT_MS = 3000

/** 計測しているか（本番だけ。2つのバインディングが両方あるとき） */
export function isMeasuring(env: { ANALYTICS?: unknown; ANALYTICS_SALTS?: unknown }): boolean {
  return env.ANALYTICS !== undefined && env.ANALYTICS_SALTS !== undefined
}

interface DimensionRow extends KeyCount {
  dimension: AnalyticsDimension
}

interface DayRow extends DimensionRow {
  date: string
}

/** 合計と推移に使う次元。日ごとの行で読む（ほかの次元は期間でまとめて読む） */
const DAILY_DIMENSIONS: AnalyticsDimension[] = ['total', 'outbound_total']

/** 日ごとの行（合計・推移・前の期間・A2 の要約） */
function readDailyRows(db: Db, from: string, to: string, dimensions: AnalyticsDimension[]): Promise<DayRow[]> {
  return db
    .select()
    .from(analyticsDaily)
    .where(
      and(gte(analyticsDaily.date, from), lte(analyticsDaily.date, to), inArray(analyticsDaily.dimension, dimensions)),
    )
}

/**
 * 期間で次元とキーごとに合計した行（一覧・到達率・その他の操作・属性）。日ごとの行を読むと、期間が長いほど
 * 行が増える（1日約60行）ので、合計は D1 で行う
 */
function readSumsByKey(db: Db, from: string, to: string): Promise<DimensionRow[]> {
  return db
    .select({
      dimension: analyticsDaily.dimension,
      key: analyticsDaily.key,
      count: sql<number>`sum(${analyticsDaily.count})`.mapWith(Number),
      visitors: sql<number>`sum(${analyticsDaily.visitors})`.mapWith(Number),
    })
    .from(analyticsDaily)
    .where(and(gte(analyticsDaily.date, from), lte(analyticsDaily.date, to)))
    .groupBy(analyticsDaily.dimension, analyticsDaily.key)
}

/**
 * 今日の分。読めない（トークンが無い・SQL API の失敗・3秒で応答しない）ときは null で、エラーにしない。
 * 表示は昨日までで出し、today.included: false で読めなかったことを伝える（SDD 5.13）。原因（トークンの期限・権限・
 * SQL API の障害・応答の形）は WARN のログに残す（runbook 3章）
 */
async function readToday(config: SqlApiConfig | null, today: string, requestId: string): Promise<DayRow[] | null> {
  if (config === null) return null
  try {
    const rows = await queryDailyRows(config, today, AbortSignal.timeout(TODAY_TIMEOUT_MS))
    return [...rows].flatMap(([dimension, counts]) => counts.map((row) => ({ date: today, dimension, ...row })))
  } catch (error) {
    log('warn', {
      msg: 'analytics today unavailable',
      requestId,
      route: 'GET /api/admin/analytics',
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    })
    return null
  }
}

function inPeriod(rows: readonly DayRow[], period: Period): DayRow[] {
  return rows.filter((row) => row.date >= period.from && row.date <= period.to)
}

function ofDimension<T extends DimensionRow>(rows: readonly T[], dimension: AnalyticsDimension): T[] {
  return rows.filter((row) => row.dimension === dimension)
}

function totalsOf(rows: readonly DimensionRow[]) {
  const pages = totalOf(ofDimension(rows, 'total'))
  return {
    pageViews: pages.count,
    visitors: pages.visitors,
    outbound: totalOf(ofDimension(rows, 'outbound_total')).count,
  }
}

/** キーごとの件数（言語・テーマの切り替え、ページング）。0件も含めて `keys` のすべてを返す */
function countsByKey<K extends string>(rows: readonly DimensionRow[], keys: readonly K[]): Record<K, number> {
  const sums = new Map(sumByKey(rows).map((row) => [row.key, row.count]))
  return Object.fromEntries(keys.map((key) => [key, sums.get(key) ?? 0])) as Record<K, number>
}

/** `{種類}:{値}` のキーを分ける。種類は `allowed` の値だけを残す（記録の形の崩れた行を一覧に出さない） */
function splitKey<K extends string>(key: string, allowed: readonly K[]): [K, string] | null {
  const at = key.indexOf(':')
  const kind = key.slice(0, at)
  return at > 0 && (allowed as readonly string[]).includes(kind) ? [kind as K, key.slice(at + 1)] : null
}

const DETAIL_PATH = /^\/(?:ja|en)\/(works|projects|blog|coding)\/([^/]+)$/
type DetailKind = 'works' | 'projects' | 'blog' | 'coding'

/** パスと行の ID から、今の D1 の中身のタイトルを引く（公開中かを問わない）。消した・スラッグを変えたものは引けない */
async function readTitles(
  db: Db,
  paths: readonly string[],
  items: readonly [ExpandableSection, string][],
): Promise<Map<string, Title>> {
  const slugs: Record<DetailKind, string[]> = { works: [], projects: [], blog: [], coding: [] }
  for (const path of paths) {
    const match = DETAIL_PATH.exec(path)
    if (match?.[1] !== undefined && match[2] !== undefined) slugs[match[1] as DetailKind].push(match[2])
  }
  const ids: Record<ExpandableSection, string[]> = { career: [], works: [], projects: [] }
  for (const [section, id] of items) ids[section].push(id)

  const bySlug = { works: work, projects: project, blog: blogPost, coding: codingLog } as const
  const byId = { career, works: work, projects: project } as const
  // キーの頭: パスは `{種類}/{スラッグ}`、行は `{セクション}:{ID}`
  const targets = [
    ...(Object.keys(bySlug) as DetailKind[])
      .filter((kind) => slugs[kind].length > 0)
      .map((kind) => {
        const table = bySlug[kind]
        const query = db
          .select({ key: table.slug, ja: table.titleJa, en: table.titleEn })
          .from(table)
          .where(inArray(table.slug, slugs[kind]))
        return { prefix: `${kind}/`, query }
      }),
    ...EXPANDABLE_SECTIONS.filter((section) => ids[section].length > 0).map((section) => {
      const table = byId[section]
      const query = db
        .select({ key: table.id, ja: table.titleJa, en: table.titleEn })
        .from(table)
        .where(inArray(table.id, ids[section]))
      return { prefix: `${section}:`, query }
    }),
  ]
  const titles = new Map<string, Title>()
  const [first, ...rest] = targets.map((target) => target.query)
  if (first === undefined) return titles
  const results = await db.batch([first, ...rest])
  results.forEach((rows, i) => {
    for (const row of rows) {
      if (row.key !== null) titles.set(`${targets[i]?.prefix}${row.key}`, { ja: row.ja, en: row.en })
    }
  })
  return titles
}

function titleOfPath(titles: ReadonlyMap<string, Title>, path: string): Title {
  const match = DETAIL_PATH.exec(path)
  return match === null ? null : (titles.get(`${match[1]}/${match[2]}`) ?? null)
}

export async function loadAnalyticsReport(input: {
  db: Db
  range: AnalyticsRange
  now: number
  config: SqlApiConfig | null
  measuring: boolean
  requestId: string
}): Promise<AnalyticsOutput> {
  const { db, range, now, config, measuring, requestId } = input
  const today = jstDateOf(now)
  const yesterday = addDays(today, -1)
  const rollupRows = await db
    .select({ date: analyticsRollup.date })
    .from(analyticsRollup)
    .orderBy(asc(analyticsRollup.date))
  const rolledUp = new Set(rollupRows.map((row) => row.date))
  const startDate = rollupRows[0]?.date ?? null
  const period = periodOf(range, today, startDate)
  const previousPeriod = previousPeriodOf(range, period, startDate)

  const [daily, sums, todayRows] = await Promise.all([
    readDailyRows(db, previousPeriod?.from ?? period.from, yesterday, DAILY_DIMENSIONS),
    readSumsByKey(db, period.from, yesterday),
    readToday(config, today, requestId),
  ])
  const days = [
    ...inPeriod(daily, period),
    ...(todayRows ?? []).filter((row) => DAILY_DIMENSIONS.includes(row.dimension)),
  ]
  const rows: DimensionRow[] = [...sums, ...(todayRows ?? [])]

  const starts = bucketStarts(bucketOf(range), period)
  const points = starts.map((start) => ({ start, pageViews: 0, visitors: 0 }))
  for (const row of ofDimension(days, 'total')) {
    const point = points[bucketIndexOf(starts, row.date)]
    if (point === undefined) continue
    point.pageViews += row.count
    point.visitors += row.visitors
  }

  const pages = topKeysOf(ofDimension(rows, 'page'))
  const readCompletes = topKeysOf(ofDimension(rows, 'read_complete'))
  const rowExpands = topKeysOf(
    ofDimension(rows, 'row_expand').filter((row) => splitKey(row.key, EXPANDABLE_SECTIONS) !== null),
  ).map((row) => ({ row, split: splitKey(row.key, EXPANDABLE_SECTIONS) as [ExpandableSection, string] }))
  const outbounds = topKeysOf(ofDimension(rows, 'outbound').filter((row) => splitKey(row.key, LINK_KINDS) !== null))
  const titles = await readTitles(
    db,
    [...pages, ...readCompletes].map((row) => row.key),
    rowExpands.map(({ split }) => split),
  )

  const topVisitors = totalOf(ofDimension(rows, 'top_view')).visitors
  const sectionVisitors = new Map(sumByKey(ofDimension(rows, 'section_view')).map((row) => [row.key, row.visitors]))

  return {
    measuring,
    range,
    from: period.from,
    to: period.to,
    today: { included: todayRows !== null },
    missingDays: missingDaysOf({ period, today, startDate, rolledUp }),
    totals: {
      ...totalsOf(days),
      previous: previousPeriod === null ? null : totalsOf(inPeriod(daily, previousPeriod)),
    },
    series: { bucket: bucketOf(range), points },
    pages: pages.map((row) => ({
      path: row.key,
      title: titleOfPath(titles, row.key),
      pageViews: row.count,
      visitors: row.visitors,
    })),
    referrers: topKeysOf(ofDimension(rows, 'referrer')),
    utm: topKeysOf(ofDimension(rows, 'utm')),
    sectionReach: TOP_SECTIONS.map((section) => {
      const visitors = sectionVisitors.get(section) ?? 0
      return { section, visitors, rate: reachRateOf(visitors, topVisitors) }
    }),
    rowExpands: rowExpands.map(({ row, split: [section, itemId] }) => ({
      section,
      itemId,
      title: titles.get(`${section}:${itemId}`) ?? null,
      count: row.count,
      visitors: row.visitors,
    })),
    outbounds: outbounds.map((row) => {
      const [linkKind, host] = splitKey(row.key, LINK_KINDS) as [LinkKind, string]
      return { linkKind, host, count: row.count, visitors: row.visitors }
    }),
    readCompletes: readCompletes.map((row) => ({
      path: row.key,
      title: titleOfPath(titles, row.key),
      count: row.count,
      visitors: row.visitors,
    })),
    otherActions: {
      langSwitch: countsByKey(ofDimension(rows, 'lang_switch'), ['ja', 'en'] as const),
      themeSwitch: countsByKey(ofDimension(rows, 'theme_switch'), THEME_CHOICES),
      // パスごとの行と (other) の合計。(other) もコピーの件数に入る
      codeCopy: totalOf(ofDimension(rows, 'code_copy')).count,
      paging: countsByKey(ofDimension(rows, 'paging'), PAGED_SECTIONS),
    },
    audience: {
      countries: topKeysOf(ofDimension(rows, 'country')),
      devices: topKeysOf(ofDimension(rows, 'device')),
      browserLangs: topKeysOf(ofDimension(rows, 'browser_lang')),
      siteLangs: topKeysOf(ofDimension(rows, 'site_lang')),
    },
  }
}

/** A2 の要約（SDD 5.4）。昨日までの7日の D1 の集計だけで、SQL API は呼ばない */
export async function loadDashboardAnalytics(db: Db, now: number, measuring: boolean) {
  const yesterday = addDays(jstDateOf(now), -1)
  const total = totalOf(await readDailyRows(db, addDays(yesterday, -6), yesterday, ['total']))
  return { measuring, pageViews: total.count, visitors: total.visitors }
}

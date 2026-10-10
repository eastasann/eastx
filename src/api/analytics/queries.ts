/**
 * 集計の次元（SDD 6.3 の analytics_daily.dimension）と、1日ぶんの SQL API の問い合わせ。blob の位置は
 * src/domain/analytics/data-point.ts（SDD 5.14 の表）と対になる。値は定数だけを埋め込み、送られた値は SQL に入れない
 */
import type { ANALYTICS_DIMENSIONS } from '../../db/enums'
import { addDays, jstDateOf, jstDayStartMs } from '../../domain/analytics/dates'
import type { EventType } from '../../domain/analytics/events'
import { type KeyCount, topWithOther, UNKNOWN_KEY } from '../../domain/analytics/rollup'
import { querySql, type SqlApiConfig } from './sql'

export type AnalyticsDimension = (typeof ANALYTICS_DIMENSIONS)[number]

/** Analytics Engine のデータセット（wrangler.jsonc の analytics_engine_datasets） */
const DATASET = 'eastx_analytics'

/** 1日ぶんの問い合わせで読む列。blob1〜blob13 が記録の値、blob14 が訪問者のハッシュ（index1 と同じ） */
const COLUMNS = [
  'blob1',
  'blob2',
  'blob3',
  'blob4',
  'blob5',
  'blob6',
  'blob7',
  'blob8',
  'blob9',
  'blob10',
  'blob11',
  'blob12',
  'blob13',
  'blob14',
] as const

type Blobs = Readonly<Record<(typeof COLUMNS)[number], string>>

/** 問い合わせの1行。記録の値と訪問者のハッシュの組と、その組の件数 */
interface EventRow {
  blobs: Blobs
  count: number
}

interface DimensionSpec {
  dimension: AnalyticsDimension
  event: EventType
  /** キーを作る列。空なら合計の次元（キーは空文字）。2列のときは `:` でつなぐ */
  columns: readonly (typeof COLUMNS)[number][]
  /** 数える組の条件。無ければ `event` の組をすべて数える */
  where?: (blobs: Blobs) => boolean
}

const SPECS: readonly DimensionSpec[] = [
  { dimension: 'total', event: 'page_view', columns: [] },
  { dimension: 'page', event: 'page_view', columns: ['blob2'] },
  { dimension: 'referrer', event: 'page_view', columns: ['blob4'], where: (blobs) => blobs.blob4 !== '' },
  { dimension: 'utm', event: 'page_view', columns: ['blob5'], where: (blobs) => blobs.blob5 !== '' },
  { dimension: 'country', event: 'page_view', columns: ['blob6'] },
  { dimension: 'device', event: 'page_view', columns: ['blob7'] },
  { dimension: 'browser_lang', event: 'page_view', columns: ['blob8'] },
  { dimension: 'site_lang', event: 'page_view', columns: ['blob3'] },
  // P1 の閲覧（セクション到達率の分母）
  {
    dimension: 'top_view',
    event: 'page_view',
    columns: [],
    where: (blobs) => blobs.blob2 === '/ja' || blobs.blob2 === '/en',
  },
  { dimension: 'section_view', event: 'section_view', columns: ['blob9'] },
  { dimension: 'read_complete', event: 'read_complete', columns: ['blob2'] },
  { dimension: 'row_expand', event: 'row_expand', columns: ['blob9', 'blob10'] },
  { dimension: 'paging', event: 'paging', columns: ['blob9'] },
  { dimension: 'outbound', event: 'outbound', columns: ['blob11', 'blob12'] },
  { dimension: 'outbound_total', event: 'outbound', columns: [] },
  { dimension: 'lang_switch', event: 'lang_switch', columns: ['blob13'] },
  { dimension: 'theme_switch', event: 'theme_switch', columns: ['blob13'] },
  { dimension: 'code_copy', event: 'code_copy', columns: ['blob2'] },
]

/**
 * 1日ぶんを1本で読む。件数は組ごとの `_sample_interval` の合計（サンプリングされた1件が表す元の件数。公式の推奨）。
 * 次元ごとに分けて送らない: Worker は応答を待つ接続を同時に6本までしか持てず、18本は3回に分かれて順に流れる（SDD 5.13）
 */
function dailySql(startSec: number, endSec: number): string {
  const columns = COLUMNS.join(', ')
  return (
    `SELECT ${columns}, SUM(_sample_interval) AS n FROM ${DATASET}` +
    ` WHERE timestamp >= toDateTime(${startSec}) AND timestamp < toDateTime(${endSec})` +
    ` GROUP BY ${columns} FORMAT JSON`
  )
}

/**
 * 応答の件数（`n`）。64ビットの整数は文字列で返ることがある。0以上の整数として読めない値は例外にする。0 に読み替えると、
 * 形の違う応答でもその日を「集計済み」で確定させてしまう
 */
function toCount(value: unknown): number {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`SQL API の応答の n を件数として読めない: ${JSON.stringify(value)}`)
  }
  return number
}

function eventRowOf(row: Record<string, unknown>): EventRow {
  const blobs = Object.fromEntries(
    COLUMNS.map((column) => {
      const value = row[column]
      if (typeof value !== 'string') {
        throw new Error(`SQL API の応答に ${column} の文字列が無い: ${JSON.stringify(value)}`)
      }
      return [column, value]
    }),
  ) as Blobs
  return { blobs, count: toCount(row.n) }
}

function keyOf(spec: DimensionSpec, blobs: Blobs): string {
  if (spec.columns.length === 0) return ''
  const key = spec.columns.map((column) => blobs[column]).join(':')
  // 合計の次元のほかは空のキーを持てない（CHECK analytics_daily_key）。ブラウザの言語が無い送信など
  return key === '' || key === ':' ? UNKNOWN_KEY : key
}

/**
 * 1つの次元のキーごとの数。件数は組の件数の合計、訪問者数はキーごとの訪問者のハッシュの種類の数。サンプリングは
 * index（訪問者）ごとに均すので、少ない訪問者の行は残り、種類の数は崩れない
 */
function countDimension(spec: DimensionSpec, rows: readonly EventRow[]): KeyCount[] {
  const byKey = new Map<string, { count: number; visitors: Set<string> }>()
  for (const { blobs, count } of rows) {
    if (blobs.blob1 !== spec.event || (spec.where !== undefined && !spec.where(blobs))) continue
    const key = keyOf(spec, blobs)
    const counted = byKey.get(key) ?? { count: 0, visitors: new Set<string>() }
    counted.count += count
    counted.visitors.add(blobs.blob14)
    byKey.set(key, counted)
  }
  return [...byKey].map(([key, { count, visitors }]) => ({ key, count, visitors: visitors.size }))
}

export type DailyRows = Map<AnalyticsDimension, KeyCount[]>

/**
 * 1日（日本時間）の全次元の行。次元ごとに上位100件と `(other)` にまとめる。応答の数・列が読めなければ例外
 */
export async function queryDailyRows(config: SqlApiConfig, date: string, signal?: AbortSignal): Promise<DailyRows> {
  const startSec = jstDayStartMs(date) / 1000
  const endSec = jstDayStartMs(addDays(date, 1)) / 1000
  const rows = (await querySql(config, dailySql(startSec, endSec), signal)).map(eventRowOf)
  return new Map(SPECS.map((spec) => [spec.dimension, topWithOther(countDimension(spec, rows))]))
}

/**
 * データセットの最も古いイベントの日（日本時間）。何も無ければ null。Analytics Engine の保持（3か月）の範囲の中の値
 */
export async function queryOldestEventDate(config: SqlApiConfig, signal?: AbortSignal): Promise<string | null> {
  const [row] = await querySql(
    config,
    `SELECT COUNT() AS n, MIN(timestamp) AS first FROM ${DATASET} FORMAT JSON`,
    signal,
  )
  if (row === undefined) throw new Error('SQL API の応答に行が無い（COUNT は必ず1行を返す）')
  if (toCount(row.n) === 0) return null
  // DateTime は UTC の 'YYYY-MM-DD hh:mm:ss' で返る
  const first =
    typeof row.first === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.first)
      ? Date.parse(`${row.first.replace(' ', 'T')}Z`)
      : Number.NaN
  if (Number.isNaN(first)) throw new Error(`最も古いイベントの時刻を読めない: ${JSON.stringify(row.first)}`)
  return jstDateOf(first)
}

/**
 * 集計の次元（SDD 6.3 の analytics_daily.dimension）ごとの SQL API の問い合わせ。blob の位置は
 * src/domain/analytics/data-point.ts（SDD 5.14 の表）と対になる。値は定数だけを埋め込み、送られた値は SQL に入れない
 */
import type { ANALYTICS_DIMENSIONS } from '../../db/enums'
import { addDays, jstDateOf, jstDayStartMs } from '../../domain/analytics/dates'
import type { EventType } from '../../domain/analytics/events'
import { type KeyCount, topWithOther, UNKNOWN_KEY } from '../../domain/analytics/rollup'
import { querySql, type SqlApiConfig } from './sql'

export type AnalyticsDimension = (typeof ANALYTICS_DIMENSIONS)[number]

/** Analytics Engine のデータセット（wrangler.jsonc の analytics_engine_datasets） */
export const DATASET = 'eastx_analytics'

interface DimensionSpec {
  dimension: AnalyticsDimension
  event: EventType
  /** キーを作る列。空なら合計の次元（キーは空文字）。2列のときは `:` でつなぐ */
  columns: readonly string[]
  where?: string
}

const SPECS: readonly DimensionSpec[] = [
  { dimension: 'total', event: 'page_view', columns: [] },
  { dimension: 'page', event: 'page_view', columns: ['blob2'] },
  { dimension: 'referrer', event: 'page_view', columns: ['blob4'], where: "blob4 != ''" },
  { dimension: 'utm', event: 'page_view', columns: ['blob5'], where: "blob5 != ''" },
  { dimension: 'country', event: 'page_view', columns: ['blob6'] },
  { dimension: 'device', event: 'page_view', columns: ['blob7'] },
  { dimension: 'browser_lang', event: 'page_view', columns: ['blob8'] },
  { dimension: 'site_lang', event: 'page_view', columns: ['blob3'] },
  // P1 の閲覧（セクション到達率の分母）
  { dimension: 'top_view', event: 'page_view', columns: [], where: "blob2 IN ('/ja', '/en')" },
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
 * 件数は `_sample_interval` の合計（サンプリングされた1件が表す元の件数。公式の推奨）。訪問者数は blob14（index1 と同じ
 * ハッシュ）の種類の数。サンプリングは index（訪問者）ごとに均すので、少ない訪問者の行は残り、種類の数は崩れない
 */
export function dimensionSql(spec: DimensionSpec, startSec: number, endSec: number): string {
  const keys = spec.columns.map((column, i) => `${column} AS k${i}, `).join('')
  const conditions = [
    `timestamp >= toDateTime(${startSec})`,
    `timestamp < toDateTime(${endSec})`,
    `blob1 = '${spec.event}'`,
    ...(spec.where === undefined ? [] : [spec.where]),
  ].join(' AND ')
  const groupBy = spec.columns.length === 0 ? '' : ` GROUP BY ${spec.columns.join(', ')}`
  return `SELECT ${keys}SUM(_sample_interval) AS n, COUNT(DISTINCT blob14) AS v FROM ${DATASET} WHERE ${conditions}${groupBy} FORMAT JSON`
}

/**
 * 応答の数。数は文字列で返ることがある（64ビットの整数）。行の無い合計（GROUP BY の無い SUM）だけは null になりうるので
 * 0 とする（`nullable`）。それ以外の読めない値は例外にする。0 に読み替えると、形の違う応答でもその日を「集計済み」で
 * 確定させてしまう
 */
function toCount(value: unknown, column: string, nullable: boolean): number {
  if (value === null && nullable) return 0
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN
  if (value === '' || !Number.isFinite(number)) {
    throw new Error(`SQL API の応答の ${column} を数として読めない: ${JSON.stringify(value)}`)
  }
  return Math.round(number)
}

function keyOf(spec: DimensionSpec, row: Record<string, unknown>): string {
  if (spec.columns.length === 0) return ''
  const parts = spec.columns.map((_, i) => {
    const value = row[`k${i}`]
    if (typeof value !== 'string') throw new Error(`SQL API の応答に k${i} の文字列が無い: ${JSON.stringify(value)}`)
    return value
  })
  const key = parts.join(':')
  // 合計の次元のほかは空のキーを持てない（CHECK analytics_daily_key）。ブラウザの言語が無い送信など
  return key === '' || key === ':' ? UNKNOWN_KEY : key
}

export type DailyRows = Map<AnalyticsDimension, KeyCount[]>

/**
 * 1日（日本時間）の全次元の行。次元ごとに上位100件と `(other)` にまとめる。問い合わせは並べて送り、1つでも失敗すれば例外
 */
export async function queryDailyRows(config: SqlApiConfig, date: string, signal?: AbortSignal): Promise<DailyRows> {
  const startSec = jstDayStartMs(date) / 1000
  const endSec = jstDayStartMs(addDays(date, 1)) / 1000
  const results = await Promise.all(
    SPECS.map(async (spec) => {
      const rows = await querySql(config, dimensionSql(spec, startSec, endSec), signal)
      const counts = rows.map((row) => ({
        key: keyOf(spec, row),
        count: toCount(row.n, 'n', spec.columns.length === 0),
        visitors: toCount(row.v, 'v', spec.columns.length === 0),
      }))
      return [spec.dimension, topWithOther(counts)] as const
    }),
  )
  return new Map(results)
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
  if (toCount(row.n, 'n', false) === 0) return null
  // DateTime は UTC の 'YYYY-MM-DD hh:mm:ss' で返る
  const first =
    typeof row.first === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.first)
      ? Date.parse(`${row.first.replace(' ', 'T')}Z`)
      : Number.NaN
  if (Number.isNaN(first)) throw new Error(`最も古いイベントの時刻を読めない: ${JSON.stringify(row.first)}`)
  return jstDateOf(first)
}

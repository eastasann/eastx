/**
 * Cron の日ごとの集計（SDD ADR-023）の規則。どの日を集計するか、1日・1次元の行をどうまとめるか
 */
import { addDays, datesBetween } from './dates'

/** Analytics Engine に残っている日数（保持は3か月）。今日の89日前より古い日は埋められない */
const RETENTION_DAYS = 90
/** 1回の実行で集計する日数の上限。長く失敗が続いた後に、CPU 時間と SQL API の呼び出しが膨らまないように */
export const MAX_DAYS_PER_RUN = 7
/** 1日・1次元に残す上位の件数。残りは `(other)` の1行にまとめる */
export const TOP_KEYS_PER_DAY = 100
export const OTHER_KEY = '(other)'
/** キーが空の行（ブラウザの言語が無いなど）のキー */
export const UNKNOWN_KEY = '(unknown)'

/**
 * Cron が集計する日の起点。`analytics_rollup` の最も古い日と、Analytics Engine に残っている最も古いイベントの日の
 * 早い方。集計した日だけを見ると、最初の日の集計が失敗して翌日が先に確定したとき、最初の日が起点の外に落ちて埋まらない。
 * どちらも無ければ null（まだ何も記録していない）
 */
export function startDateOf(oldestRolledUp: string | null, oldestEventDate: string | null): string | null {
  if (oldestRolledUp === null) return oldestEventDate
  if (oldestEventDate === null) return oldestRolledUp
  return oldestRolledUp < oldestEventDate ? oldestRolledUp : oldestEventDate
}

/**
 * 今回集計する日。(1) 昨日と一昨日（遅れて Analytics Engine に入った送信を拾うため、集計済みでも毎回やり直す）、
 * (2) max(開始日, 今日の89日前) から3日前までのうち、まだ集計していない日を古い順に。合わせて MAX_DAYS_PER_RUN 日まで。
 * 開始日より前の日は集計しない（計測前の空の日で埋めない）
 */
export function datesToRollUp(input: {
  today: string
  startDate: string | null
  rolledUp: ReadonlySet<string>
}): string[] {
  const { today, startDate, rolledUp } = input
  if (startDate === null) return []
  const recent = [addDays(today, -1), addDays(today, -2)].filter((date) => date >= startDate)
  const oldest = [startDate, addDays(today, -(RETENTION_DAYS - 1))].sort().at(-1) ?? startDate
  const gaps = datesBetween(oldest, addDays(today, -3)).filter((date) => !rolledUp.has(date))
  return [...recent, ...gaps].slice(0, MAX_DAYS_PER_RUN)
}

export interface KeyCount {
  key: string
  count: number
  visitors: number
}

/** 件数の多い順。同じなら key の昇順（結果を毎回同じにする） */
export function byCountDesc(a: KeyCount, b: KeyCount): number {
  return b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
}

/**
 * 上位 `limit` 件と、残りをまとめた `(other)` の1行（残りがあるときだけ）。`(other)` の訪問者数は残りの行の合計で、
 * 同じ人が重なりうるので上限の目安（A10 は出さない）。件数が0の行は残さない
 */
export function topWithOther(rows: readonly KeyCount[], limit = TOP_KEYS_PER_DAY): KeyCount[] {
  // 記録した値が予約のキーと同じなら残りに入れる。上位と (other) で同じキーが2行になると、日の書き込みが主キーで落ちる
  const counted = rows.filter((row) => row.count > 0)
  const sorted = counted.filter((row) => row.key !== OTHER_KEY).sort(byCountDesc)
  const top = sorted.slice(0, limit)
  const rest = [...sorted.slice(limit), ...counted.filter((row) => row.key === OTHER_KEY)]
  if (rest.length === 0) return top
  return [
    ...top,
    {
      key: OTHER_KEY,
      count: rest.reduce((sum, row) => sum + row.count, 0),
      visitors: rest.reduce((sum, row) => sum + row.visitors, 0),
    },
  ]
}

/** `size` 件ずつに分ける（D1 の1文のパラメーターの上限に収めるため。ADR-006） */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

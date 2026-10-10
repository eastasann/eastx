/**
 * 解析の日付（日本時間の暦の日。`YYYY-MM-DD`。SDD 5.0）の計算。日本時間は夏時間を持たないので、UTC に9時間を足して求める
 */

const DAY_MS = 24 * 60 * 60 * 1000
const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

function fromUtcMidnight(ms: number): string {
  const date = new Date(ms)
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** 日付の UTC の 00:00（日付の計算だけに使う。日本時間の日の境目は jstDayStartMs） */
function utcMidnightOf(date: string): number {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

/** UNIX ミリ秒の時刻が日本時間で何日か */
export function jstDateOf(ms: number): string {
  return fromUtcMidnight(ms + TOKYO_OFFSET_MS)
}

/** 日本時間のその日の 00:00 の UNIX ミリ秒 */
export function jstDayStartMs(date: string): number {
  return utcMidnightOf(date) - TOKYO_OFFSET_MS
}

export function addDays(date: string, days: number): string {
  return fromUtcMidnight(utcMidnightOf(date) + days * DAY_MS)
}

/** `from` から `to` までの日数（両端を含む）。`to` が前なら0 */
export function dayCount(from: string, to: string): number {
  return Math.max(0, Math.round((utcMidnightOf(to) - utcMidnightOf(from)) / DAY_MS) + 1)
}

/** `from` から `to` までの日（両端を含む、古い順） */
export function datesBetween(from: string, to: string): string[] {
  const count = dayCount(from, to)
  return Array.from({ length: count }, (_, i) => addDays(from, i))
}

/** 曜日。0 が日曜 */
export function weekdayOf(date: string): number {
  return new Date(utcMidnightOf(date)).getUTCDay()
}

/** その日の月の1日 */
export function monthStartOf(date: string): string {
  return `${date.slice(0, 7)}-01`
}

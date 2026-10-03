/**
 * 日付の書式（design-spec 1.4、SDD 9章）。日時は日本時間（Asia/Tokyo）で出す。
 * 年月（`YYYY-MM`）は時刻を持たないので、その月の1日を UTC で整形してタイムゾーンでずれないようにする。
 */
import type { Lang } from './detect'

const LOCALES: Record<Lang, string> = { ja: 'ja-JP', en: 'en-US' }

const yearMonthFormats: Record<Lang, Intl.DateTimeFormat> = {
  ja: new Intl.DateTimeFormat(LOCALES.ja, { year: 'numeric', month: 'long', timeZone: 'UTC' }),
  en: new Intl.DateTimeFormat(LOCALES.en, { year: 'numeric', month: 'short', timeZone: 'UTC' }),
}

const dateFormats: Record<Lang, Intl.DateTimeFormat> = {
  ja: new Intl.DateTimeFormat(LOCALES.ja, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' }),
  en: new Intl.DateTimeFormat(LOCALES.en, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Tokyo' }),
}

// 管理画面の表記は区切りを固定したいので、ロケールの既定の書式に頼らず部品から組み立てる
const adminDateParts = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Tokyo',
})

const PRESENT: Record<Lang, string> = { ja: '現在', en: 'Present' }

const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/

function yearMonthToDate(value: string): Date {
  const match = YEAR_MONTH.exec(value)
  if (!match) throw new RangeError(`年月は YYYY-MM: ${value}`)
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1))
}

/** 日時は API の ISO 8601 の文字列か、DB の UNIX ミリ秒（SDD 5.0・6.1） */
export type DateInput = Date | string | number

function toDate(value: DateInput): Date {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new RangeError(`日時として読めない: ${String(value)}`)
  return date
}

/** `2026-09` → 「2026年9月」／「Sep 2026」 */
export function formatYearMonth(lang: Lang, value: string): string {
  return yearMonthFormats[lang].format(yearMonthToDate(value))
}

/** 日時 → 「2026年9月12日」／「Sep 12, 2026」 */
export function formatDate(lang: Lang, value: DateInput): string {
  return dateFormats[lang].format(toDate(value))
}

/** 期間 → 「2024年4月 – 現在」／「Apr 2024 – Present」。終わりが null なら現在まで */
export function formatPeriod(lang: Lang, start: string, end: string | null): string {
  return `${formatYearMonth(lang, start)} – ${end === null ? PRESENT[lang] : formatYearMonth(lang, end)}`
}

/** 管理画面の日付 → 「2026/09/12」 */
export function formatAdminDate(value: DateInput): string {
  const parts = Object.fromEntries(adminDateParts.formatToParts(toDate(value)).map((p) => [p.type, p.value]))
  return `${parts.year}/${parts.month}/${parts.day}`
}

/** 管理画面の年月 → 「2026/09」 */
export function formatAdminYearMonth(value: string): string {
  yearMonthToDate(value)
  return value.replace('-', '/')
}

/** 日本時間のオフセット。Asia/Tokyo は夏時間を持たないので固定 */
const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000

/** 日時 → 日時の入力欄（`<input type="datetime-local">`）の値。日本時間の分まで（`2026-09-12T19:00`） */
export function toTokyoDateTimeInput(value: DateInput): string {
  return new Date(toDate(value).getTime() + TOKYO_OFFSET_MS).toISOString().slice(0, 16)
}

const DATE_TIME_INPUT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

/**
 * 日時の入力欄の値（日本時間）→ API に送る ISO 8601（`+09:00` 付き）。空なら null。
 * 入力欄の形でない値は、API の入力チェックで理由を出すためにそのまま返す
 */
export function fromTokyoDateTimeInput(value: string): string | null {
  if (value === '') return null
  const match = DATE_TIME_INPUT.exec(value)
  if (!match) return value
  return `${value}${match[1] === undefined ? ':00' : ''}+09:00`
}

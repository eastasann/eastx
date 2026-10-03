import { describe, expect, it } from 'vitest'
import {
  formatAdminDate,
  formatAdminYearMonth,
  formatDate,
  formatPeriod,
  formatYearMonth,
  fromTokyoDateTimeInput,
  toTokyoDateTimeInput,
} from './format'

describe('formatYearMonth', () => {
  it('日本語は「2026年9月」、英語は「Sep 2026」', () => {
    expect(formatYearMonth('ja', '2026-09')).toBe('2026年9月')
    expect(formatYearMonth('en', '2026-09')).toBe('Sep 2026')
  })

  it('月の境目でタイムゾーンによってずれない', () => {
    expect(formatYearMonth('ja', '2024-01')).toBe('2024年1月')
    expect(formatYearMonth('en', '2024-12')).toBe('Dec 2024')
  })

  it('YYYY-MM でない値は投げる', () => {
    expect(() => formatYearMonth('ja', '2024-13')).toThrow(RangeError)
    expect(() => formatYearMonth('ja', '2024-1')).toThrow(RangeError)
  })
})

describe('formatDate', () => {
  it('日本語は「2026年9月12日」、英語は「Sep 12, 2026」', () => {
    const ms = Date.UTC(2026, 8, 12, 3, 0)
    expect(formatDate('ja', ms)).toBe('2026年9月12日')
    expect(formatDate('en', ms)).toBe('Sep 12, 2026')
  })

  it('日本時間で日付を決める（UTC の 15:00 は翌日）', () => {
    expect(formatDate('ja', '2026-09-11T15:00:00.000Z')).toBe('2026年9月12日')
    expect(formatDate('en', '2026-09-11T14:59:59.999Z')).toBe('Sep 11, 2026')
  })

  it('読めない日時は投げる', () => {
    expect(() => formatDate('ja', 'not a date')).toThrow(RangeError)
  })
})

describe('formatPeriod', () => {
  it('終わりがあれば両端を出す', () => {
    expect(formatPeriod('ja', '2023-04', '2024-03')).toBe('2023年4月 – 2024年3月')
    expect(formatPeriod('en', '2023-04', '2024-03')).toBe('Apr 2023 – Mar 2024')
  })

  it('終わりがなければ「現在」「Present」', () => {
    expect(formatPeriod('ja', '2024-04', null)).toBe('2024年4月 – 現在')
    expect(formatPeriod('en', '2024-04', null)).toBe('Apr 2024 – Present')
  })
})

describe('管理画面の表記', () => {
  it('日付は「2026/09/12」で、日本時間の日付', () => {
    expect(formatAdminDate(Date.UTC(2026, 8, 12, 3, 0))).toBe('2026/09/12')
    expect(formatAdminDate(new Date('2026-09-11T15:00:00.000Z'))).toBe('2026/09/12')
  })

  it('年月は「2026/09」', () => {
    expect(formatAdminYearMonth('2026-09')).toBe('2026/09')
    expect(() => formatAdminYearMonth('2026/09')).toThrow(RangeError)
  })
})

describe('toTokyoDateTimeInput・fromTokyoDateTimeInput', () => {
  it('日本時間の分までの入力値にする（UTC の 15:00 は翌日の 0:00）', () => {
    expect(toTokyoDateTimeInput('2026-09-11T15:00:37.123Z')).toBe('2026-09-12T00:00')
    expect(toTokyoDateTimeInput(Date.UTC(2026, 8, 12, 10, 5))).toBe('2026-09-12T19:05')
  })

  it('入力値を日本時間のオフセット付きの ISO 8601 にする', () => {
    expect(fromTokyoDateTimeInput('2026-09-12T19:05')).toBe('2026-09-12T19:05:00+09:00')
    expect(fromTokyoDateTimeInput('2026-09-12T19:05:30')).toBe('2026-09-12T19:05:30+09:00')
    expect(new Date(fromTokyoDateTimeInput('2026-09-12T00:00') ?? '').toISOString()).toBe('2026-09-11T15:00:00.000Z')
  })

  it('空は null、入力欄の形でない値はそのまま返す', () => {
    expect(fromTokyoDateTimeInput('')).toBeNull()
    expect(fromTokyoDateTimeInput('2026/09/12')).toBe('2026/09/12')
  })
})

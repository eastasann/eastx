import { describe, expect, it } from 'vitest'
import { addDays, datesBetween, dayCount, jstDateOf, jstDayStartMs, monthStartOf, weekdayOf } from './dates'

describe('日本時間の日付', () => {
  it('UTC の 15:00 の前後で日が変わる', () => {
    expect(jstDateOf(Date.parse('2026-10-09T14:59:59.999Z'))).toBe('2026-10-09')
    expect(jstDateOf(Date.parse('2026-10-09T15:00:00.000Z'))).toBe('2026-10-10')
  })

  it('その日の 00:00 JST は前日の 15:00 UTC', () => {
    expect(new Date(jstDayStartMs('2026-10-10')).toISOString()).toBe('2026-10-09T15:00:00.000Z')
  })

  it('日の足し引き・数え上げ（月・年をまたぐ、うるう年）', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
    expect(dayCount('2026-10-01', '2026-10-07')).toBe(7)
    expect(dayCount('2026-10-07', '2026-10-01')).toBe(0)
    expect(datesBetween('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'])
  })

  it('曜日と月の1日', () => {
    expect(weekdayOf('2026-10-12')).toBe(1)
    expect(monthStartOf('2026-10-12')).toBe('2026-10-01')
  })
})

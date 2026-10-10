import { describe, expect, it } from 'vitest'
import {
  bucketIndexOf,
  bucketOf,
  bucketStarts,
  changeRateOf,
  missingDaysOf,
  periodOf,
  previousPeriodOf,
  reachRateOf,
  sumByKey,
  topKeysOf,
  totalOf,
} from './report'

const today = '2026-10-10'

describe('periodOf', () => {
  it('今日を含む N 日。1y は365日', () => {
    expect(periodOf('7d', today, null)).toEqual({ from: '2026-10-04', to: today })
    expect(periodOf('30d', today, null)).toEqual({ from: '2026-09-11', to: today })
    expect(periodOf('90d', today, null)).toEqual({ from: '2026-07-13', to: today })
    expect(periodOf('1y', today, null)).toEqual({ from: '2025-10-11', to: today })
  })

  it('all は開始日から今日まで。開始日が無ければ今日だけ', () => {
    expect(periodOf('all', today, '2025-01-15')).toEqual({ from: '2025-01-15', to: today })
    expect(periodOf('all', today, null)).toEqual({ from: today, to: today })
  })
})

describe('previousPeriodOf', () => {
  it('同じ長さの直前の期間', () => {
    expect(previousPeriodOf('7d', { from: '2026-10-04', to: today }, '2026-01-01')).toEqual({
      from: '2026-09-27',
      to: '2026-10-03',
    })
  })

  it('直前の期間が開始日より前に始まる・開始日が無い・all のときは null', () => {
    const period = { from: '2026-10-04', to: today }
    expect(previousPeriodOf('7d', period, '2026-09-28')).toBeNull()
    expect(previousPeriodOf('7d', period, '2026-09-27')).not.toBeNull()
    expect(previousPeriodOf('7d', period, null)).toBeNull()
    expect(previousPeriodOf('all', period, '2026-01-01')).toBeNull()
  })
})

describe('区切り', () => {
  it('7d・30d・90d は日、1y は週、all は月', () => {
    expect(bucketOf('7d')).toBe('day')
    expect(bucketOf('90d')).toBe('day')
    expect(bucketOf('1y')).toBe('week')
    expect(bucketOf('all')).toBe('month')
  })

  it('日は期間のすべての日', () => {
    expect(bucketStarts('day', { from: '2026-10-08', to: today })).toEqual(['2026-10-08', '2026-10-09', today])
  })

  it('週は月曜始まりで、最初の区切りは期間の最初の日から', () => {
    // 2026-10-01 は木曜、10-05・10-12 が月曜
    expect(bucketStarts('week', { from: '2026-10-01', to: '2026-10-13' })).toEqual([
      '2026-10-01',
      '2026-10-05',
      '2026-10-12',
    ])
  })

  it('月は1日始まりで、最初の区切りは開始日から（月の途中でもよい）', () => {
    expect(bucketStarts('month', { from: '2026-08-20', to: today })).toEqual(['2026-08-20', '2026-09-01', '2026-10-01'])
  })

  it('その日が入る区切り', () => {
    const starts = ['2026-10-01', '2026-10-05', '2026-10-12']
    expect(bucketIndexOf(starts, '2026-10-01')).toBe(0)
    expect(bucketIndexOf(starts, '2026-10-04')).toBe(0)
    expect(bucketIndexOf(starts, '2026-10-05')).toBe(1)
    expect(bucketIndexOf(starts, '2026-10-13')).toBe(2)
  })
})

describe('missingDaysOf', () => {
  const period = { from: '2026-10-04', to: today }

  it('開始日から昨日までで集計していない日を数え、今日は数えない', () => {
    const rolledUp = new Set(['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-08', '2026-10-09'])
    expect(missingDaysOf({ period, today, startDate: '2026-01-01', rolledUp })).toBe(1)
  })

  it('開始日より前の日は数えない。開始日が無ければ0', () => {
    expect(missingDaysOf({ period, today, startDate: '2026-10-08', rolledUp: new Set(['2026-10-08']) })).toBe(1)
    expect(missingDaysOf({ period, today, startDate: null, rolledUp: new Set() })).toBe(0)
  })
})

describe('期間でまとめる', () => {
  const rows = [
    { key: '/ja', count: 5, visitors: 3 },
    { key: '/en', count: 2, visitors: 2 },
    { key: '/ja', count: 4, visitors: 2 },
    { key: '(other)', count: 50, visitors: 40 },
  ]

  it('同じキーを合計し、(other) は除く', () => {
    expect(sumByKey(rows)).toEqual([
      { key: '/ja', count: 9, visitors: 5 },
      { key: '/en', count: 2, visitors: 2 },
    ])
  })

  it('上位 N 件（件数の多い順）', () => {
    expect(topKeysOf(rows, 1)).toEqual([{ key: '/ja', count: 9, visitors: 5 }])
  })

  it('件数と訪問者数の合計', () => {
    expect(totalOf(rows.slice(0, 3))).toEqual({ count: 11, visitors: 7 })
    expect(totalOf([])).toEqual({ count: 0, visitors: 0 })
  })

  it('到達率は分母が0なら null', () => {
    expect(reachRateOf(72, 100)).toBe(0.72)
    expect(reachRateOf(0, 0)).toBeNull()
  })

  it('前の期間との差は前が0なら null', () => {
    expect(changeRateOf(112, 100)).toBeCloseTo(0.12)
    expect(changeRateOf(95, 100)).toBeCloseTo(-0.05)
    expect(changeRateOf(5, 0)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { chunk, datesToRollUp, startDateOf, topWithOther } from './rollup'

const today = '2026-10-10'

describe('startDateOf', () => {
  it('集計済みの最も古い日と最も古いイベントの日の早い方。どちらも無ければ null', () => {
    // 最初の日の集計が失敗し、翌日が先に確定した
    expect(startDateOf('2026-09-02', '2026-09-01')).toBe('2026-09-01')
    // 古いイベントは保持（3か月）を過ぎて消えた
    expect(startDateOf('2026-06-01', '2026-07-12')).toBe('2026-06-01')
    expect(startDateOf(null, '2026-08-01')).toBe('2026-08-01')
    expect(startDateOf('2026-08-01', null)).toBe('2026-08-01')
    expect(startDateOf(null, null)).toBeNull()
  })
})

describe('datesToRollUp', () => {
  it('開始日が無ければ何もしない', () => {
    expect(datesToRollUp({ today, startDate: null, rolledUp: new Set() })).toEqual([])
  })

  it('昨日と一昨日は集計済みでもやり直す', () => {
    const rolledUp = new Set(['2026-10-07', '2026-10-08', '2026-10-09'])
    expect(datesToRollUp({ today, startDate: '2026-10-07', rolledUp })).toEqual(['2026-10-09', '2026-10-08'])
  })

  it('3日前までの集計していない日を古い順に足す', () => {
    const rolledUp = new Set(['2026-10-04', '2026-10-06'])
    expect(datesToRollUp({ today, startDate: '2026-10-03', rolledUp })).toEqual([
      '2026-10-09',
      '2026-10-08',
      '2026-10-03',
      '2026-10-05',
      '2026-10-07',
    ])
  })

  it('開始日より前の日は集計しない（今日始まったなら何もしない、昨日なら昨日だけ）', () => {
    expect(datesToRollUp({ today, startDate: today, rolledUp: new Set() })).toEqual([])
    expect(datesToRollUp({ today, startDate: '2026-10-09', rolledUp: new Set() })).toEqual(['2026-10-09'])
  })

  it('1回で7日まで。残りは次の実行に回す', () => {
    const dates = datesToRollUp({ today, startDate: '2026-09-01', rolledUp: new Set() })
    expect(dates).toEqual([
      '2026-10-09',
      '2026-10-08',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ])
  })

  it('Analytics Engine の保持（今日の89日前）より古い日は埋めない', () => {
    const rolledUp = new Set(['2026-07-15'])
    const dates = datesToRollUp({ today, startDate: '2026-07-01', rolledUp })
    expect(dates.slice(2)).toEqual(['2026-07-13', '2026-07-14', '2026-07-16', '2026-07-17', '2026-07-18'])
  })
})

describe('topWithOther', () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ key: `/p/${String(i).padStart(3, '0')}`, count: n - i, visitors: 1 }))

  it('件数の多い順（同じなら key の昇順）。上位に収まれば (other) を作らない', () => {
    expect(
      topWithOther([
        { key: 'b', count: 2, visitors: 1 },
        { key: 'a', count: 2, visitors: 2 },
        { key: 'c', count: 5, visitors: 3 },
      ]).map((row) => row.key),
    ).toEqual(['c', 'a', 'b'])
  })

  it('上位100件と、残りの件数・訪問者数の合計の (other)', () => {
    const result = topWithOther(rows(103))
    expect(result).toHaveLength(101)
    expect(result[99]?.key).toBe('/p/099')
    expect(result[100]).toEqual({ key: '(other)', count: 3 + 2 + 1, visitors: 3 })
  })

  it('予約のキー (other) と同じ値の行は残りに入れ、(other) を2行にしない', () => {
    const result = topWithOther([...rows(101), { key: '(other)', count: 500, visitors: 7 }])
    expect(result.filter((row) => row.key === '(other)')).toEqual([{ key: '(other)', count: 1 + 500, visitors: 1 + 7 }])
    expect(topWithOther([{ key: '(other)', count: 2, visitors: 1 }])).toEqual([
      { key: '(other)', count: 2, visitors: 1 },
    ])
  })

  it('件数が0の行は残さない', () => {
    expect(topWithOther([{ key: '', count: 0, visitors: 0 }])).toEqual([])
  })
})

describe('chunk', () => {
  it('size 件ずつに分ける', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 20)).toEqual([])
  })
})

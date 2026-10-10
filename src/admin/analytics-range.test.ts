import { describe, expect, it } from 'vitest'
import { ANALYTICS_RANGE_KEY, resolveRange } from './analytics-range'

const storage = (value: string | null) => ({ getItem: (key: string) => (key === ANALYTICS_RANGE_KEY ? value : null) })

describe('resolveRange（design-spec 6.8 の期間の決め方）', () => {
  it('URL のクエリがあればそれ', () => {
    expect(resolveRange('7d', storage('1y'))).toBe('7d')
  })

  it('クエリが無ければ、このブラウザに覚えた値', () => {
    expect(resolveRange(undefined, storage('90d'))).toBe('90d')
  })

  it('どちらも無い・読めない値・ストレージを使えないときは30日', () => {
    expect(resolveRange(undefined, storage(null))).toBe('30d')
    expect(resolveRange(undefined, storage('2d'))).toBe('30d')
    expect(resolveRange(undefined, null)).toBe('30d')
    expect(
      resolveRange(undefined, {
        getItem: () => {
          throw new Error('SecurityError')
        },
      }),
    ).toBe('30d')
  })
})

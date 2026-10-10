/**
 * A10 の期間の決め方（design-spec 6.8）。URL のクエリ → このブラウザに覚えた値 → 30日 の順。
 * 覚えた値を書くのは期間のセグメントを押したときだけで、クエリ付きで開いたとき（A2 の要約から 7日で来たとき）は書き換えない
 */
import { ANALYTICS_RANGES, type AnalyticsRange } from '~/domain/analytics/report'
import { readView } from './view-preference'

export const ANALYTICS_RANGE_KEY = 'eastx:admin:analytics-range'
export const DEFAULT_ANALYTICS_RANGE: AnalyticsRange = '30d'

export function resolveRange(
  query: AnalyticsRange | undefined,
  storage: Pick<Storage, 'getItem'> | null,
): AnalyticsRange {
  return query ?? readView(storage, ANALYTICS_RANGE_KEY, ANALYTICS_RANGES, DEFAULT_ANALYTICS_RANGE)
}

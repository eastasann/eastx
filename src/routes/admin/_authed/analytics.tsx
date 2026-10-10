import { createFileRoute } from '@tanstack/react-router'
import { AnalyticsPage, type AnalyticsSearch } from '~/admin/analytics'
import { pickEnum } from '~/admin/search'
import { ANALYTICS_RANGES } from '~/domain/analytics/report'

// A10 アクセス解析（design-spec 6.8）。期間はクエリで持つ（SDD 4.1）
export const Route = createFileRoute('/admin/_authed/analytics')({
  validateSearch: (search): AnalyticsSearch => ({ range: pickEnum(search.range, ANALYTICS_RANGES) }),
  component: Analytics,
})

function Analytics() {
  return <AnalyticsPage search={Route.useSearch()} />
}

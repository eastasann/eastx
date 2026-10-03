import { createFileRoute } from '@tanstack/react-router'
import { CareersListPage, type CareersSearch } from '~/admin/careers'
import { pickEnum } from '~/admin/search'
import { CAREER_KINDS, STATUSES } from '~/db/schema'

// A4 経歴管理の一覧（design-spec 6.6）。絞り込みはクエリで持つ（SDD 4.1）
export const Route = createFileRoute('/admin/_authed/careers/')({
  validateSearch: (search): CareersSearch => ({
    status: pickEnum(search.status, STATUSES),
    kind: pickEnum(search.kind, CAREER_KINDS),
  }),
  component: CareersList,
})

function CareersList() {
  return <CareersListPage search={Route.useSearch()} />
}

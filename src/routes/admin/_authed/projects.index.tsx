import { createFileRoute } from '@tanstack/react-router'
import { PortfolioListPage, type PortfolioSearch } from '~/admin/portfolio'
import { pickEnum } from '~/admin/search'
import { STATUSES } from '~/db/schema'

// A6 プロジェクト管理の一覧（design-spec 6.6）。絞り込みはクエリで持つ（SDD 4.1）
export const Route = createFileRoute('/admin/_authed/projects/')({
  validateSearch: (search): PortfolioSearch => ({ status: pickEnum(search.status, STATUSES) }),
  component: ProjectsList,
})

function ProjectsList() {
  return <PortfolioListPage kind="project" search={Route.useSearch()} />
}

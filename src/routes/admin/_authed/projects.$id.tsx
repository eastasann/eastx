import { createFileRoute } from '@tanstack/react-router'
import { PortfolioEditPage } from '~/admin/portfolio'

// A6 プロジェクト管理の編集（design-spec 6.7）。id が new なら新規作成（SDD 4.1）
export const Route = createFileRoute('/admin/_authed/projects/$id')({
  component: ProjectsEdit,
})

function ProjectsEdit() {
  const { id } = Route.useParams()
  return <PortfolioEditPage kind="project" id={id} />
}

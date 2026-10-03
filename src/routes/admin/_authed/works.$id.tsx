import { createFileRoute } from '@tanstack/react-router'
import { PortfolioEditPage } from '~/admin/portfolio'

// A5 作品管理の編集（design-spec 6.7）。id が new なら新規作成（SDD 4.1）
export const Route = createFileRoute('/admin/_authed/works/$id')({
  component: WorksEdit,
})

function WorksEdit() {
  const { id } = Route.useParams()
  return <PortfolioEditPage kind="work" id={id} />
}

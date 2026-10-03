import { createFileRoute } from '@tanstack/react-router'
import { CareerEditPage } from '~/admin/careers'

// A4 経歴管理の編集（design-spec 6.7）。id が new なら新規作成（SDD 4.1）
export const Route = createFileRoute('/admin/_authed/careers/$id')({
  component: CareerEdit,
})

function CareerEdit() {
  const { id } = Route.useParams()
  return <CareerEditPage id={id} />
}

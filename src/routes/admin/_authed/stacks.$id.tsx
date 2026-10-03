import { createFileRoute } from '@tanstack/react-router'
import { StackEditPage } from '~/admin/stacks'

// A7 使用技術管理の編集（design-spec 6.7）。id が new なら新規作成（SDD 4.1）
export const Route = createFileRoute('/admin/_authed/stacks/$id')({
  component: StackEdit,
})

function StackEdit() {
  const { id } = Route.useParams()
  return <StackEditPage id={id} />
}

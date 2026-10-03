import { createFileRoute } from '@tanstack/react-router'
import { PostEditPage } from '~/admin/posts'

// A9 コーディング記録管理の編集（design-spec 6.7）。id が new なら新規作成（SDD 4.1）
export const Route = createFileRoute('/admin/_authed/coding/$id')({
  component: CodingEdit,
})

function CodingEdit() {
  const { id } = Route.useParams()
  return <PostEditPage kind="coding-log" id={id} />
}

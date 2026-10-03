import { createFileRoute } from '@tanstack/react-router'
import { PostEditPage } from '~/admin/posts'

// A8 ブログ管理の編集（design-spec 6.7）。id が new なら新規作成（SDD 4.1）
export const Route = createFileRoute('/admin/_authed/blog/$id')({
  component: BlogEdit,
})

function BlogEdit() {
  const { id } = Route.useParams()
  return <PostEditPage kind="blog-post" id={id} />
}

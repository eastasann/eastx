import { createFileRoute } from '@tanstack/react-router'
import { PostsListPage, type PostsSearch } from '~/admin/posts'
import { pickEnum } from '~/admin/search'
import { STATUSES } from '~/db/enums'

// A8 ブログ管理の一覧（design-spec 6.6）。絞り込みはクエリで持つ（SDD 4.1）
export const Route = createFileRoute('/admin/_authed/blog/')({
  validateSearch: (search): PostsSearch => ({ status: pickEnum(search.status, STATUSES) }),
  component: BlogList,
})

function BlogList() {
  return <PostsListPage kind="blog-post" search={Route.useSearch()} />
}

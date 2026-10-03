import { createFileRoute } from '@tanstack/react-router'
import { PostsListPage, type PostsSearch } from '~/admin/posts'
import { pickEnum } from '~/admin/search'
import { CODING_LOG_KINDS, STATUSES } from '~/db/schema'

// A9 コーディング記録管理の一覧（design-spec 6.6）。絞り込みはクエリで持つ（SDD 4.1）
export const Route = createFileRoute('/admin/_authed/coding/')({
  validateSearch: (search): PostsSearch => ({
    status: pickEnum(search.status, STATUSES),
    kind: pickEnum(search.kind, CODING_LOG_KINDS),
  }),
  component: CodingList,
})

function CodingList() {
  return <PostsListPage kind="coding-log" search={Route.useSearch()} />
}

import { createFileRoute } from '@tanstack/react-router'
import { StacksListPage } from '~/admin/stacks'

// A7 使用技術管理の一覧（design-spec 6.6）
export const Route = createFileRoute('/admin/_authed/stacks/')({
  component: StacksListPage,
})

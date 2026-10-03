import { createFileRoute } from '@tanstack/react-router'
import { ListLayout } from '~/admin/layouts'

// A2 ダッシュボード（design-spec 6.5）。件数・下書きの一覧などの中身は Step 7。ここではログインの行き先として見出しだけ
export const Route = createFileRoute('/admin/_authed/')({
  component: DashboardPage,
})

function DashboardPage() {
  return <ListLayout title="ダッシュボード" />
}

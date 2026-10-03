import { createFileRoute } from '@tanstack/react-router'
import { DashboardPage } from '~/admin/dashboard'

// A2 ダッシュボード（design-spec 6.5）
export const Route = createFileRoute('/admin/_authed/')({
  component: DashboardPage,
})

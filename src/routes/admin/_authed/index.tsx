import { createFileRoute } from '@tanstack/react-router'
import { css } from 'styled-system/css'

// A2 ダッシュボード（design-spec 6.5）。件数・下書きの一覧などの中身は Step 7。ここではログインの行き先として見出しだけ
export const Route = createFileRoute('/admin/_authed/')({
  component: DashboardPage,
})

function DashboardPage() {
  return <h1 className={css({ textStyle: 'heading-1' })}>ダッシュボード</h1>
}

import { createFileRoute } from '@tanstack/react-router'
import { ProfilePage } from '~/admin/profile'

// A3 プロフィール編集（design-spec 6.7.2）
export const Route = createFileRoute('/admin/_authed/profile')({
  component: ProfilePage,
})

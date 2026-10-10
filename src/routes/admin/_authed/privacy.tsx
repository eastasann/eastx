import { createFileRoute } from '@tanstack/react-router'
import { PrivacyPage } from '~/admin/privacy'

// A11 プライバシー編集（design-spec 6.7.2）
export const Route = createFileRoute('/admin/_authed/privacy')({
  component: PrivacyPage,
})

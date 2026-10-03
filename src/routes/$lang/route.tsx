import { createFileRoute, notFound, Outlet } from '@tanstack/react-router'
import { isLang } from '~/i18n/detect'

// `$lang` が ja・en 以外は C1（HTTP 404。SDD 4.1）
export const Route = createFileRoute('/$lang')({
  beforeLoad: ({ params }) => {
    if (!isLang(params.lang)) throw notFound()
  },
  component: Outlet,
})

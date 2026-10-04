import { createRouter, type ErrorComponentProps, useRouterState } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { useReportBrowserError } from './monitoring/browser'
import { routeTree } from './routeTree.gen'
import { DefaultRouteError } from './site/status-pages'

// 管理画面の部品は公開側のバンドルに入れない（SDD 7章「パフォーマンス」）
const AdminRouteError = lazy(() => import('./admin/route-error').then((m) => ({ default: m.AdminRouteError })))

/** 既定の errorComponent。受けた例外を送り（SDD 11章）、管理画面と公開側で出し方を分ける（SDD 8章） */
function RouteError(props: ErrorComponentProps) {
  useReportBrowserError(props.error)
  const isAdmin = useRouterState({ select: (state) => state.location.pathname.startsWith('/admin') })
  if (isAdmin) {
    return (
      <Suspense fallback={null}>
        <AdminRouteError {...props} />
      </Suspense>
    )
  }
  return <DefaultRouteError {...props} />
}

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: 'intent',
    scrollRestoration: true,
    defaultErrorComponent: RouteError,
  })
}

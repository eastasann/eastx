import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { SESSION_CHECK_FAILED_ERROR } from '~/admin/auth'
import { AdminShell } from '~/admin/layouts'
import { authClient } from '~/auth/client'

/**
 * A2〜A9 の共通のレイアウト（SDD 4.1）。表示の前にセッションを確かめ、なければ A1 へ移す。
 * ここは表示のためのガードで、守りの正は CMS API の認可（SDD 7章）。
 * get-session はセッションの期限の延長も兼ねる（SDD 5.1。CMS API の認証では延長しない）
 */
export const Route = createFileRoute('/admin/_authed')({
  ssr: false,
  head: () => ({ meta: [{ title: 'eastasian 管理画面' }, { name: 'robots', content: 'noindex' }] }),
  beforeLoad: async ({ location }) => {
    const result = await authClient.getSession().catch(() => null)
    if (result === null || result.error) {
      throw redirect({
        to: '/admin/login',
        search: { redirect: location.href, error: SESSION_CHECK_FAILED_ERROR },
        replace: true,
      })
    }
    if (!result.data) throw redirect({ to: '/admin/login', search: { redirect: location.href }, replace: true })
    return { user: result.data.user }
  },
  component: AuthedLayout,
})

function AuthedLayout() {
  const { user } = Route.useRouteContext()
  return (
    <AdminShell githubLogin={user.githubLogin}>
      <Outlet />
    </AdminShell>
  )
}

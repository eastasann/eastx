import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { SESSION_CHECK_FAILED_ERROR } from '~/admin/auth'
import { AdminShell } from '~/admin/layouts'
import { reportBrowserError } from '~/monitoring/browser'

/**
 * A2〜A9 の共通のレイアウト（SDD 4.1）。表示の前にセッションを確かめ、なければ A1 へ移す。
 * ここは表示のためのガードで、守りの正は CMS API の認可（SDD 7章）。
 * get-session はセッションの期限の延長も兼ねる（SDD 5.1。CMS API の認証では延長しない）
 */
export const Route = createFileRoute('/admin/_authed')({
  ssr: false,
  head: () => ({ meta: [{ title: 'eastasian 管理画面' }, { name: 'robots', content: 'noindex' }] }),
  beforeLoad: async ({ location }) => {
    // ルートの設定（beforeLoad）は公開側と同じバンドルに入るので、Better Auth のクライアントはここで読み込む（SDD 7章）。
    // 読み込めない（デプロイで古いチャンクが消えたなど）ときも、セッションを確かめられないときと同じ A1 の通信エラーにし、
    // 想定外のエラーとして送る
    const result = await import('~/auth/client').then(
      ({ authClient }) => authClient.getSession().catch(() => null),
      (error: unknown) => {
        reportBrowserError(error)
        return null
      },
    )
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

/**
 * 失敗は画面の「再試行」で読み直す（design-spec 6.5〜6.7.4）ので、自動の再試行はしない。
 * 自動の再試行は「読み込めませんでした」を出すのを遅らせ、期限切れ（UNAUTHORIZED）も繰り返す。
 * 窓に戻ったときの読み直しもしない。編集中のフォームは読み込んだ値を元にしていて、裏で値が変わると比べる元がずれる
 */
function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  })
}

function AuthedLayout() {
  const { user } = Route.useRouteContext()
  const [queryClient] = useState(createQueryClient)
  return (
    <QueryClientProvider client={queryClient}>
      <AdminShell githubLogin={user.githubLogin}>
        <Outlet />
      </AdminShell>
    </QueryClientProvider>
  )
}

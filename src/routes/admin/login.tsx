import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { css } from 'styled-system/css'
import { LOGIN_MESSAGES, loginErrorState, parseLoginSearch, safeRedirect } from '~/admin/auth'
import { CenteredCardLayout } from '~/admin/layouts'
import { authClient } from '~/auth/client'
import { reportBrowserError } from '~/monitoring/browser'
import { button } from '~/ui/recipes'

// A1 ログイン（design-spec 6.4）。レイアウトは L3 中央カード
export const Route = createFileRoute('/admin/login')({
  ssr: false,
  validateSearch: parseLoginSearch,
  head: () => ({ meta: [{ title: 'ログイン | eastasian 管理画面' }, { name: 'robots', content: 'noindex' }] }),
  beforeLoad: async ({ search }) => {
    // ログイン済みで開いたら戻る先へ送る。error が付いているとき（管理者でないセッションが残っている場合を含む）は
    // 送り返すと A1 と管理画面の間を行き来するので、A1 のまま状態を出す
    if (search.error !== undefined) return
    // 確かめられないときは未ログインとして A1 をそのまま出す。ログインし直せば済むので、ここでは通信エラーを出さない。
    // ルートの設定（beforeLoad）は公開側と同じバンドルに入るので、Better Auth のクライアントはここで読み込む（SDD 7章）。
    // 読み込めない（デプロイで古いチャンクが消えたなど）ときも A1 をそのまま出し、想定外のエラーとして送る
    const { data } = await import('~/auth/client').then(
      ({ authClient }) => authClient.getSession().catch(() => ({ data: null })),
      (error: unknown) => {
        reportBrowserError(error)
        return { data: null }
      },
    )
    if (data) throw redirect({ href: safeRedirect(search.redirect), replace: true })
  },
  component: LoginPage,
})

type Status = 'idle' | 'pending' | 'failed'

function LoginPage() {
  const search = Route.useSearch()
  const [status, setStatus] = useState<Status>('idle')

  async function signIn() {
    setStatus('pending')
    const callbackURL = safeRedirect(search.redirect)
    // 失敗して A1 に戻ったときも、もう一度ログインすれば元の画面へ戻れるよう redirect を残す
    const errorCallbackURL =
      search.redirect === undefined ? '/admin/login' : `/admin/login?${new URLSearchParams({ redirect: callbackURL })}`
    try {
      const { error } = await authClient.signIn.social({ provider: 'github', callbackURL, errorCallbackURL })
      // 成功したときはクライアントが GitHub の認可画面へ移すので、ボタンは無効のままにする
      if (error) setStatus('failed')
    } catch {
      setStatus('failed')
    }
  }

  const message = (() => {
    if (status === 'pending') return { text: LOGIN_MESSAGES.pending, tone: 'muted' as const }
    if (status === 'failed') return { text: LOGIN_MESSAGES.network, tone: 'danger' as const }
    if (search.error !== undefined)
      return { text: LOGIN_MESSAGES[loginErrorState(search.error)], tone: 'danger' as const }
    if (search.loggedOut) return { text: LOGIN_MESSAGES.loggedOut, tone: 'muted' as const }
    return null
  })()

  return (
    <CenteredCardLayout>
      <h1 className={css({ textStyle: 'heading-2', textAlign: 'center' })}>eastasian 管理画面</h1>
      <button type="button" onClick={signIn} disabled={status === 'pending'} className={button()}>
        GitHubでログイン
      </button>
      {/* 役割を途中で変えると読み上げが追従しないので、1つの status の領域で状態の変化を伝える */}
      <p
        role="status"
        className={css({
          textStyle: 'body-sm',
          textAlign: 'center',
          color: message?.tone === 'danger' ? 'danger.default' : 'text.muted',
          _empty: { display: 'none' },
        })}
      >
        {message?.text}
      </p>
    </CenteredCardLayout>
  )
}

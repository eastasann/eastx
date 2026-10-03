import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { css } from 'styled-system/css'
import { LOGIN_MESSAGES, loginErrorState, parseLoginSearch, safeRedirect } from '~/admin/auth'
import { authClient } from '~/auth/client'

// A1 ログイン（design-spec 6.4）。レイアウトは L3 中央カード。部品への切り出しは Step 5
export const Route = createFileRoute('/admin/login')({
  ssr: false,
  validateSearch: parseLoginSearch,
  head: () => ({ meta: [{ title: 'ログイン | eastasian 管理画面' }, { name: 'robots', content: 'noindex' }] }),
  beforeLoad: async ({ search }) => {
    // ログイン済みで開いたら戻る先へ送る。error が付いているとき（管理者でないセッションが残っている場合を含む）は
    // 送り返すと A1 と管理画面の間を行き来するので、A1 のまま状態を出す
    if (search.error !== undefined) return
    // 確かめられないときは未ログインとして A1 をそのまま出す。ログインし直せば済むので、ここでは通信エラーを出さない
    const { data } = await authClient.getSession().catch(() => ({ data: null }))
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
    <main
      className={css({
        minH: 'dvh',
        display: 'grid',
        placeItems: 'center',
        p: 'gutter',
        bg: 'bg.subtle',
      })}
    >
      <div
        className={css({
          display: 'flex',
          flexDirection: 'column',
          gap: 'stack',
          p: 'inset',
          bg: 'surface.default',
          borderWidth: 'default',
          borderStyle: 'solid',
          borderColor: 'border.default',
          borderRadius: 'card',
        })}
      >
        <h1 className={css({ textStyle: 'heading-2', textAlign: 'center' })}>eastasian 管理画面</h1>
        <button
          type="button"
          onClick={signIn}
          disabled={status === 'pending'}
          className={css({
            h: 'control',
            px: 'inline',
            textStyle: 'ui',
            color: 'text.on-accent',
            bg: 'accent.default',
            borderRadius: 'control',
            cursor: 'pointer',
            transitionProperty: 'background-color',
            transitionDuration: 'motion.hover',
            transitionTimingFunction: 'motion.hover',
            _hover: { bg: 'accent.hover' },
            _focusVisible: { outlineWidth: 'focus-ring', outlineStyle: 'solid', outlineColor: 'focus-ring' },
            _disabled: { opacity: 'disabled', cursor: 'not-allowed', _hover: { bg: 'accent.default' } },
          })}
        >
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
      </div>
    </main>
  )
}

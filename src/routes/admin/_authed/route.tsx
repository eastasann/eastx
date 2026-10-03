import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { css } from 'styled-system/css'
import { SESSION_CHECK_FAILED_ERROR } from '~/admin/auth'
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

// サイドメニューの項目・テーマの切り替えと L4〜L6 のレイアウトは Step 5。ここでは下部のユーザー名とログアウト
function AuthedLayout() {
  const { user } = Route.useRouteContext()
  return (
    <div className={css({ display: 'flex', minH: 'dvh' })}>
      <nav
        aria-label="管理メニュー"
        className={css({
          w: 'sidebar',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          gap: 'stack-dense',
          p: 'inset-dense',
          bg: 'bg.subtle',
          borderRightWidth: 'default',
          borderRightStyle: 'solid',
          borderRightColor: 'border.default',
        })}
      >
        <p className={css({ textStyle: 'meta', color: 'text.muted' })}>@{user.githubLogin}</p>
        <LogoutButton />
      </nav>
      <main className={css({ flex: '1', p: 'inset' })}>
        <Outlet />
      </main>
    </div>
  )
}

function LogoutButton() {
  const [status, setStatus] = useState<'idle' | 'pending' | 'failed'>('idle')

  async function logout() {
    setStatus('pending')
    const result = await authClient.signOut().catch(() => null)
    if (result === null || result.error) {
      setStatus('failed')
      return
    }
    // ログアウトしたセッションの画面の状態とキャッシュを持ち越さないよう、ページを読み込み直す（src/admin/api.ts と同じ）
    window.location.replace('/admin/login?loggedOut=1')
  }

  return (
    <>
      <button
        type="button"
        onClick={logout}
        disabled={status === 'pending'}
        className={css({
          textStyle: 'ui',
          textAlign: 'start',
          color: 'text.default',
          cursor: 'pointer',
          _hover: { color: 'accent.hover' },
          _focusVisible: { outlineWidth: 'focus-ring', outlineStyle: 'solid', outlineColor: 'focus-ring' },
          _disabled: { opacity: 'disabled', cursor: 'not-allowed' },
        })}
      >
        ログアウト
      </button>
      <p role="status" className={css({ textStyle: 'body-sm', color: 'danger.default', _empty: { display: 'none' } })}>
        {status === 'failed' ? 'ログアウトできませんでした。もう一度お試しください' : null}
      </p>
    </>
  )
}

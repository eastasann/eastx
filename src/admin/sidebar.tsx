/**
 * 管理画面のサイドメニュー（design-spec 3.3・4.1・4.3）。上からメニュー項目、下部にログイン中の GitHub のユーザー名・
 * テーマの切り替え・ログアウト。デスクトップ幅は常に表示、タブレット幅はアイコンだけ、モバイル幅はメニューボタンから引き出しで開く
 */
import { useLocation } from '@tanstack/react-router'
import { type ComponentType, useState } from 'react'
import { css } from 'styled-system/css'
import { authClient } from '~/auth/client'
import {
  BoxIcon,
  BriefcaseIcon,
  CodeIcon,
  DashboardIcon,
  FolderIcon,
  LayersIcon,
  LogoutIcon,
  PenIcon,
  UserIcon,
} from '~/ui/icons'
import { ThemeToggle } from '~/ui/theme'
import { Tooltip } from '~/ui/tooltip'
import { AdminLink } from './link'

interface MenuEntry {
  /** 移る先のパス。一覧のルートを足していないものも、ここで並びを決める（3.3 の末尾） */
  to: string
  label: string
  icon: ComponentType<{ size?: 'md' | 'sm' }>
}

export const ADMIN_MENU: readonly MenuEntry[] = [
  { to: '/admin', label: 'ダッシュボード', icon: DashboardIcon },
  { to: '/admin/profile', label: 'プロフィール', icon: UserIcon },
  { to: '/admin/careers', label: '経歴', icon: BriefcaseIcon },
  { to: '/admin/projects', label: 'プロジェクト', icon: FolderIcon },
  { to: '/admin/works', label: '作品', icon: BoxIcon },
  { to: '/admin/stacks', label: '使用技術', icon: LayersIcon },
  { to: '/admin/blog', label: 'ブログ', icon: PenIcon },
  { to: '/admin/coding', label: 'コーディング記録', icon: CodeIcon },
]

const THEME_LABELS = {
  toggle: (current: string, next: string) => `テーマ: ${current}（押すと${next}）`,
  system: 'OSに合わせる',
  light: 'ライト',
  dark: 'ダーク',
}

/** ダッシュボードは完全一致、それ以外は配下（一覧から開いた編集ビュー）も今いる場所に含める */
function isCurrent(entry: MenuEntry, pathname: string): boolean {
  if (entry.to === '/admin') return pathname === '/admin' || pathname === '/admin/'
  return pathname === entry.to || pathname.startsWith(`${entry.to}/`)
}

export interface SidebarContentProps {
  githubLogin: string
  /** タブレット幅でアイコンだけにする */
  collapsed: boolean
  /** 項目を押したとき（引き出しを閉じる） */
  onNavigate?: () => void
}

// 縮めた項目は itemBase の余白・色を上書きするので、クラスを cx で並べず、スタイルを重ねて1つの css にする
// （同じプロパティのクラスは、並べた順ではなくスタイルシートの順で勝ち負けが決まる）
const itemBaseStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'inline',
  minH: 'control',
  px: 'inset-dense',
  textStyle: 'ui',
  color: 'text.default',
  textDecoration: 'none',
  borderRadius: 'control',
  _hover: { bg: 'bg.muted' },
  '&[aria-current=page]': { color: 'accent.default', bg: 'accent.subtle' },
} as const
const collapsedItemStyle = { justifyContent: 'center', px: 'none' } as const

const itemBase = css(itemBaseStyle)
const collapsedItem = css(itemBaseStyle, collapsedItemStyle)

export function SidebarContent({ githubLogin, collapsed, onNavigate }: SidebarContentProps) {
  const { pathname } = useLocation()

  return (
    <nav
      aria-label="管理メニュー"
      className={css({ display: 'flex', flexDirection: 'column', gap: 'stack-dense', flex: '1' })}
    >
      <ul className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}>
        {ADMIN_MENU.map((entry) => {
          const Icon = entry.icon
          return (
            <li key={entry.to}>
              <Tooltip content={entry.label} placement="right" enabled={collapsed}>
                <AdminLink
                  href={entry.to}
                  onNavigate={onNavigate}
                  aria-current={isCurrent(entry, pathname) ? 'page' : undefined}
                  aria-label={collapsed ? entry.label : undefined}
                  className={collapsed ? collapsedItem : itemBase}
                >
                  <Icon />
                  {!collapsed && <span>{entry.label}</span>}
                </AdminLink>
              </Tooltip>
            </li>
          )
        })}
      </ul>

      <div
        className={css({
          display: 'flex',
          flexDirection: 'column',
          gap: 'inline',
          mt: 'auto',
          pt: 'stack-dense',
          borderTopWidth: 'default',
          borderTopStyle: 'solid',
          borderTopColor: 'border.default',
        })}
      >
        {collapsed ? (
          <Tooltip content={`@${githubLogin}`} placement="right">
            <p
              className={css(itemBaseStyle, collapsedItemStyle, { color: 'text.muted', _hover: { bg: 'transparent' } })}
            >
              <UserIcon />
              <span className={css({ srOnly: true })}>@{githubLogin}</span>
            </p>
          </Tooltip>
        ) : (
          <p className={css({ px: 'inset-dense', textStyle: 'meta', color: 'text.muted', truncate: true })}>
            @{githubLogin}
          </p>
        )}
        <Tooltip content="テーマを切り替える" placement="right" enabled={collapsed}>
          <ThemeToggle labels={THEME_LABELS} showLabel={!collapsed} />
        </Tooltip>
        <LogoutButton collapsed={collapsed} />
      </div>
    </nav>
  )
}

function LogoutButton({ collapsed }: { collapsed: boolean }) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'failed'>('idle')

  async function logout() {
    setStatus('pending')
    // 失敗の中身は画面に出さず、もう一度押してもらう（design-spec 6.4）。原因の調べはサーバー側のログで行う
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
      <Tooltip content="ログアウト" placement="right" enabled={collapsed}>
        <button
          type="button"
          onClick={logout}
          disabled={status === 'pending'}
          aria-label={collapsed ? 'ログアウト' : undefined}
          className={css(itemBaseStyle, collapsed ? collapsedItemStyle : {}, {
            cursor: 'pointer',
            textAlign: 'start',
            _disabled: { opacity: 'disabled', cursor: 'not-allowed' },
          })}
        >
          <LogoutIcon />
          {!collapsed && <span>ログアウト</span>}
        </button>
      </Tooltip>
      <p role="status" className={css({ textStyle: 'body-sm', color: 'danger.default', _empty: { display: 'none' } })}>
        {status === 'failed' ? 'ログアウトできませんでした。もう一度お試しください' : null}
      </p>
    </>
  )
}

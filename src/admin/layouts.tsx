/**
 * 管理画面のレイアウト（design-spec 4.1・4.3）。L3 はログイン（A1）、L4〜L6 はサイドメニューの右側の中身。
 * サイドメニューを含む外枠は AdminShell で、`admin/_authed/route.tsx` が置く
 */
import { type ReactNode, useState } from 'react'
import { css } from 'styled-system/css'
import { Dialog } from '~/ui/dialog'
import { MenuIcon } from '~/ui/icons'
import { button } from '~/ui/recipes'
import { Tabs } from '~/ui/tabs'
import { Toaster } from '~/ui/toast'
import { MEDIA, useMediaQuery } from '~/ui/use-media-query'
import { SidebarContent } from './sidebar'

/** L3 中央カード。ヘッダーやメニューはない */
export function CenteredCardLayout({ children }: { children: ReactNode }) {
  return (
    <main className={css({ minH: 'dvh', display: 'grid', placeItems: 'center', p: 'gutter', bg: 'bg.subtle' })}>
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
        {children}
      </div>
    </main>
  )
}

/** L4〜L6 の外枠。左にサイドメニュー、右に中身。トーストの出す場所もここに1つだけ置く */
export function AdminShell({ githubLogin, children }: { githubLogin: string; children: ReactNode }) {
  const isMobile = useMediaQuery(MEDIA.mobile)
  const isTablet = useMediaQuery(MEDIA.tablet)
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className={css({ display: 'flex', minH: 'dvh' })}>
      {!isMobile && (
        <aside
          className={css({
            position: 'sticky',
            top: 'none',
            h: 'dvh',
            w: { base: 'sidebar', tablet: 'sidebar-collapsed', desktop: 'sidebar' },
            flexShrink: 0,
            display: 'flex',
            overflowY: 'auto',
            p: 'inset-dense',
            bg: 'bg.subtle',
            borderRightWidth: 'default',
            borderRightStyle: 'solid',
            borderRightColor: 'border.default',
            zIndex: 'sidebar',
          })}
        >
          <SidebarContent githubLogin={githubLogin} collapsed={isTablet} />
        </aside>
      )}
      {/* 中身が幅より広いとき（テーブル・コードブロック）にページごと横へはみ出さないよう、ここで横のスクロールを受ける */}
      <div className={css({ flex: '1', overflowX: 'auto', display: 'flex', flexDirection: 'column' })}>
        {isMobile && (
          <div
            className={css({
              display: 'flex',
              alignItems: 'center',
              gap: 'inline',
              h: 'header',
              px: 'gutter',
              bg: 'bg.subtle',
              borderBottomWidth: 'default',
              borderBottomStyle: 'solid',
              borderBottomColor: 'border.default',
            })}
          >
            <button
              type="button"
              aria-label="メニュー"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
              className={button({ variant: 'ghost', shape: 'icon' })}
            >
              <MenuIcon />
            </button>
            <p className={css({ textStyle: 'heading-3' })}>eastasian 管理画面</p>
          </div>
        )}
        <main className={css({ flex: '1', p: 'inset' })}>{children}</main>
      </div>
      {isMobile && (
        <Dialog
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          title="管理メニュー"
          hideTitle
          closeLabel="閉じる"
          placement="start"
        >
          <SidebarContent githubLogin={githubLogin} collapsed={false} onNavigate={() => setDrawerOpen(false)} />
        </Dialog>
      )}
      <Toaster />
    </div>
  )
}

export interface AdminPageProps {
  /** 操作バーの上の戻るリンク（編集ビューの「← 一覧」） */
  back?: ReactNode
  title: ReactNode
  /** 操作バーのボタン・絞り込みなど */
  actions?: ReactNode
  children: ReactNode
}

/** 右側の上部の操作バー（見出しと操作）。L4〜L6 で共通 */
function Toolbar({ back, title, actions }: Pick<AdminPageProps, 'back' | 'title' | 'actions'>) {
  const bar = (
    <div
      className={css({
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'stack-dense',
      })}
    >
      <h1 className={css({ textStyle: 'heading-1' })}>{title}</h1>
      {actions !== undefined && (
        <div className={css({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'inline' })}>{actions}</div>
      )}
    </div>
  )
  if (back === undefined) return bar
  return (
    <div className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}>
      {back}
      {bar}
    </div>
  )
}

const page = css({ display: 'flex', flexDirection: 'column', gap: 'stack-dense' })

/** L4 サイドメニュー＋一覧。操作バーの下に、テーブルや件数カードなどの一覧 */
export function ListLayout({ title, actions, children }: Omit<AdminPageProps, 'children'> & { children?: ReactNode }) {
  return (
    <div className={page}>
      <Toolbar title={title} actions={actions} />
      {/* モバイル幅でテーブルが入りきらないときは、ページではなく一覧の中で横へスクロールさせる */}
      {children !== undefined && <div className={css({ overflowX: 'auto' })}>{children}</div>}
    </div>
  )
}

export interface SplitEditLayoutProps extends Omit<AdminPageProps, 'children'> {
  /** 操作バーの下の基本項目 */
  fields: ReactNode
  editor: ReactNode
  preview: ReactNode
}

/**
 * L5 サイドメニュー＋2ペイン編集。基本項目の下を「Markdownエディタ ／ プレビュー」に分ける。
 * モバイル幅ではタブで切り替える。2つ描くとエディタの状態が分かれるので、幅に合わせてどちらか一方だけを描く
 */
export function SplitEditLayout({ back, title, actions, fields, editor, preview }: SplitEditLayoutProps) {
  const isMobile = useMediaQuery(MEDIA.mobile)
  return (
    <div className={page}>
      <Toolbar back={back} title={title} actions={actions} />
      {fields}
      {isMobile ? (
        <Tabs
          label="本文"
          items={[
            { value: 'editor', label: 'エディタ', content: editor },
            { value: 'preview', label: 'プレビュー', content: preview },
          ]}
        />
      ) : (
        <div
          className={css({
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: 'stack-dense',
            alignItems: 'start',
          })}
        >
          <section aria-label="エディタ">{editor}</section>
          <section aria-label="プレビュー">{preview}</section>
        </div>
      )}
    </div>
  )
}

/** L6 サイドメニュー＋フォーム。右に1列のフォーム */
export function FormLayout({ back, title, actions, children }: AdminPageProps) {
  return (
    <div className={page}>
      <Toolbar back={back} title={title} actions={actions} />
      <div className={css({ display: 'flex', flexDirection: 'column', gap: 'stack-dense', maxW: 'content' })}>
        {children}
      </div>
    </div>
  )
}

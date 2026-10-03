/**
 * 管理画面のレイアウト（design-spec 4.1・4.3）。L3 はログイン（A1）、L4〜L6 はサイドメニューの右側の中身。
 * サイドメニューを含む外枠は AdminShell で、`admin/_authed/route.tsx` が置く
 */
import { type ReactNode, useId, useRef, useState } from 'react'
import { css } from 'styled-system/css'
import { Dialog } from '~/ui/dialog'
import { MenuIcon } from '~/ui/icons'
import { button } from '~/ui/recipes'
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
  /** 画面に場所を持たないもの（確認ダイアログなど） */
  children?: ReactNode
}

/**
 * L5 サイドメニュー＋2ペイン編集。基本項目の下を「Markdownエディタ ／ プレビュー」に分ける。
 * モバイル幅ではタブで切り替える。エディタは幅が変わっても同じ場所に描いたまま、見せる・隠すだけを変える
 * （別の要素の下へ描き直すと、エディタが作り直されて元に戻す履歴とアップロード中の画像の行き先が消える）
 */
export function SplitEditLayout({ back, title, actions, fields, editor, preview, children }: SplitEditLayoutProps) {
  const isMobile = useMediaQuery(MEDIA.mobile)
  const [pane, setPane] = useState<Pane>('editor')
  const id = useId()
  const tabs = useRef<Record<Pane, HTMLButtonElement | null>>({ editor: null, preview: null })
  const panes: { value: Pane; label: string; content: ReactNode }[] = [
    { value: 'editor', label: 'エディタ', content: editor },
    { value: 'preview', label: 'プレビュー', content: preview },
  ]

  function select(next: Pane) {
    setPane(next)
    tabs.current[next]?.focus()
  }

  return (
    <div className={page}>
      <Toolbar back={back} title={title} actions={actions} />
      {fields}
      {isMobile && (
        <div
          role="tablist"
          aria-label="本文"
          className={css({
            display: 'flex',
            gap: 'inline',
            borderBottomWidth: 'default',
            borderBottomStyle: 'solid',
            borderBottomColor: 'border.default',
          })}
        >
          {panes.map((item) => (
            <button
              key={item.value}
              ref={(element) => {
                tabs.current[item.value] = element
              }}
              type="button"
              role="tab"
              id={`${id}-${item.value}-tab`}
              aria-selected={pane === item.value}
              aria-controls={`${id}-${item.value}`}
              tabIndex={pane === item.value ? 0 : -1}
              onClick={() => setPane(item.value)}
              onKeyDown={(event) => {
                // 2つだけなので、左右どちらの矢印でももう一方へ移る（Ark UI のタブと同じ操作）
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault()
                  select(item.value === 'editor' ? 'preview' : 'editor')
                }
              }}
              className={paneTab}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <div
        className={css({
          display: 'grid',
          gridTemplateColumns: { base: 'minmax(0, 1fr)', tablet: 'minmax(0, 1fr) minmax(0, 1fr)' },
          gap: 'stack-dense',
          alignItems: 'start',
        })}
      >
        {panes.map((item) => (
          <section
            key={item.value}
            id={`${id}-${item.value}`}
            {...(isMobile
              ? { role: 'tabpanel', 'aria-labelledby': `${id}-${item.value}-tab` }
              : { 'aria-label': item.label })}
            hidden={isMobile && pane !== item.value}
          >
            {item.content}
          </section>
        ))}
      </div>
      {children}
    </div>
  )
}

type Pane = 'editor' | 'preview'

// 見た目は src/ui/tabs.tsx のタブにそろえる
const paneTab = css({
  display: 'inline-flex',
  alignItems: 'center',
  h: 'control',
  px: 'inset-dense',
  textStyle: 'ui',
  color: 'text.muted',
  cursor: 'pointer',
  borderBottomWidth: 'emphasis',
  borderBottomStyle: 'solid',
  borderBottomColor: 'transparent',
  _hover: { color: 'text.default' },
  '&[aria-selected=true]': { color: 'accent.default', borderBottomColor: 'accent.default' },
})

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

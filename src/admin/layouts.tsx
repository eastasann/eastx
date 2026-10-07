/**
 * 管理画面のレイアウト（design-spec 4.1・4.3）。L3 はログイン（A1）、L4〜L6 はサイドメニューの右側の中身。
 * サイドメニューを含む外枠は AdminShell で、`admin/_authed/route.tsx` が置く
 */
import { createContext, type ReactNode, useContext, useLayoutEffect, useState } from 'react'
import { css } from 'styled-system/css'
import type { Lang } from '~/i18n/detect'
import { Dialog } from '~/ui/dialog'
import { ColumnsIcon, EyeIcon, LanguagesIcon, MenuIcon, PenIcon, SettingsIcon, SingleIcon } from '~/ui/icons'
import { button, label } from '~/ui/recipes'
import { SegmentGroup, type SegmentItem } from '~/ui/segment-group'
import { Toaster } from '~/ui/toast'
import { MEDIA, useMediaQuery } from '~/ui/use-media-query'
import { SidebarContent } from './sidebar'
import { Skeleton } from './states'
import type { EditorView, FormView } from './view-preference'

/** L3 中央カード。ヘッダーやメニューはない */
export function CenteredCardLayout({ children }: { children: ReactNode }) {
  return (
    <main className={css({ minH: 'dvh', display: 'grid', placeItems: 'center', p: 'gutter', bg: 'bg.canvas' })}>
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

/**
 * 編集ビュー（L5・L6）を開いているあいだ、デスクトップ幅でもサイドメニューをアイコンだけにし、中身の外側の余白を
 * 編集ビューに任せる（design-spec 4.1）。編集ビューのレイアウトが開いているあいだだけ知らせる
 */
const EditingContext = createContext<(editing: boolean) => void>(() => {})

function useEditingView() {
  const setEditing = useContext(EditingContext)
  // 描く前に縮める（useEffect だと、広いサイドメニューを一度描いてから縮むので画面が跳ぶ）
  useLayoutEffect(() => {
    setEditing(true)
    return () => setEditing(false)
  }, [setEditing])
}

/** L4〜L6 の外枠。左にサイドメニュー、右に中身。トーストの出す場所もここに1つだけ置く */
export function AdminShell({ githubLogin, children }: { githubLogin: string; children: ReactNode }) {
  const isMobile = useMediaQuery(MEDIA.mobile)
  const isTablet = useMediaQuery(MEDIA.tablet)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const collapsed = isTablet || editing

  return (
    <EditingContext.Provider value={setEditing}>
      <div className={css({ display: 'flex', minH: 'dvh' })}>
        {!isMobile && (
          <aside
            data-collapsed={collapsed}
            className={css({
              position: 'sticky',
              top: 'none',
              h: 'dvh',
              w: 'sidebar',
              flexShrink: 0,
              display: 'flex',
              overflowY: 'auto',
              p: 'inset-dense',
              bg: 'bg.canvas',
              borderRightWidth: 'default',
              borderRightStyle: 'solid',
              borderRightColor: 'border.default',
              zIndex: 'sidebar',
              '&[data-collapsed=true]': { w: 'sidebar-collapsed' },
            })}
          >
            <SidebarContent githubLogin={githubLogin} collapsed={collapsed} />
          </aside>
        )}
        <div
          data-editing={editing}
          className={css({
            flex: '1',
            // 中身が幅より広いとき（テーブル・コードブロック）にページごと横へはみ出さないよう、ここで横のスクロールを受ける
            overflowX: 'auto',
            display: 'flex',
            flexDirection: 'column',
            // 編集ビューは操作バーを上に固定する。スクロールの入れ物にすると固定がこの要素の中で決まって効かないので、
            // はみ出しは切るだけにする（編集ビューの中身は自分の中で横にスクロールする）
            '&[data-editing=true]': { overflowX: 'clip' },
          })}
        >
          {isMobile && (
            <div
              className={css({
                display: 'flex',
                alignItems: 'center',
                gap: 'inline',
                h: 'header',
                px: 'gutter',
                bg: 'bg.canvas',
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
          <main
            data-editing={editing}
            className={css({
              flex: '1',
              display: 'flex',
              flexDirection: 'column',
              p: 'inset',
              '&[data-editing=true]': { p: 'none' },
            })}
          >
            {children}
          </main>
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
    </EditingContext.Provider>
  )
}

// ---- L4 -----------------------------------------------------------------------

const page = css({ display: 'flex', flexDirection: 'column', gap: 'stack-dense' })

/** L4 サイドメニュー＋一覧。操作バー（見出しと操作）の下に、テーブルや件数カードなどの一覧 */
export function ListLayout({
  title,
  actions,
  children,
}: {
  title: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className={page}>
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
          <div className={css({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'inline' })}>
            {actions}
          </div>
        )}
      </div>
      {/* モバイル幅でテーブルが入りきらないときは、ページではなく一覧の中で横へスクロールさせる */}
      {children !== undefined && <div className={css({ overflowX: 'auto' })}>{children}</div>}
    </div>
  )
}

/**
 * モバイル幅では見せず読み上げだけに残す文字（固定の操作バーを低く保つため、戻るリンクと「設定」ボタンはアイコンだけにする）
 */
export function WideOnlyText({ children }: { children: ReactNode }) {
  return (
    <>
      <span className={css({ hideBelow: 'tablet' })}>{children}</span>
      <span className={css({ hideFrom: 'tablet', srOnly: true })}>{children}</span>
    </>
  )
}

// ---- 編集ビューの操作バー（L5・L6） ---------------------------------------------------

export interface EditToolbarProps {
  /** 戻るリンク（「← 一覧」） */
  back?: ReactNode
  /** 題（design-spec 6.7: 日本語のタイトル、なければ英語、どちらも無ければ「新規作成」） */
  title: ReactNode
  /** 状態の札と保存の状態 */
  status?: ReactNode
  /** 表示の切り替え */
  view?: ReactNode
  /** ボタン（押せない理由を含む） */
  actions?: ReactNode
}

/** 上に固定する操作バー（design-spec 4.1）。題・状態・表示の切り替え・ボタンを、狭い幅では折り返して並べる */
function EditToolbar({ back, title, status, view, actions }: EditToolbarProps) {
  return (
    <div
      className={css({
        position: 'sticky',
        top: 'none',
        zIndex: 'toolbar',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 'stack-dense',
        rowGap: 'inline',
        px: 'inset',
        py: 'inset-dense',
        bg: 'bg.canvas',
        borderBottomWidth: 'default',
        borderBottomStyle: 'solid',
        borderBottomColor: 'border.default',
      })}
    >
      <div
        className={css({
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: 'stack-dense',
          rowGap: 'inline-tight',
          flex: '1',
          // 題が長くても、ボタンを押し出さずに題の方を省略する。ただし、題と状態が読める幅（popover）より狭くなるなら、
          // 縮めずにボタンを次の行へ折り返す
          minW: 'popover',
          overflow: 'hidden',
        })}
      >
        {back}
        <h1 className={css({ textStyle: 'heading-3', truncate: true })}>{title}</h1>
        {status !== undefined && (
          <div className={css({ display: 'flex', alignItems: 'center', gap: 'stack-dense' })}>{status}</div>
        )}
      </div>
      {view}
      {actions !== undefined && (
        <div className={css({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'inline' })}>{actions}</div>
      )}
    </div>
  )
}

// ---- L5 -----------------------------------------------------------------------

// 表示の切り替えはアイコンだけにし、名前はツールチップと読み上げで伝える（design-spec 6.7 の操作バー）
const EDITOR_VIEW_ITEMS: readonly SegmentItem<EditorView>[] = [
  { value: 'write', label: '書く', icon: PenIcon },
  { value: 'split', label: '並べる', icon: ColumnsIcon },
  { value: 'bilingual', label: '日英', icon: LanguagesIcon },
  { value: 'preview', label: 'プレビュー', icon: EyeIcon },
]

// モバイル幅は左右に並べられないので「並べる」を出さない（design-spec 4.3 の並び）
const MOBILE_EDITOR_VIEW_ITEMS: readonly SegmentItem<EditorView>[] = [
  { value: 'write', label: '書く', icon: PenIcon },
  { value: 'preview', label: 'プレビュー', icon: EyeIcon },
  { value: 'bilingual', label: '日英', icon: LanguagesIcon },
]

export interface SplitEditLayoutProps extends EditToolbarProps {
  /** 描く表示（幅で使えないものは書き換え済み） */
  view: EditorView
  onViewChange: (view: EditorView) => void
  /** 言語タブ（「日英」のときは出さない）。言語ごとの欄を中身に持つ */
  tabs: ReactNode
  /** 「日英」のときの、言語ごとの見出しと欄 */
  localized: (lang: Lang) => ReactNode
  /** 本文のエディタ。表示を切り替えても作り直さないよう、言語ごとに同じ場所に描き続ける */
  editors: Record<Lang, ReactNode>
  /** 選んでいる言語（「日英」以外で、エディタを出す言語） */
  lang: Lang
  preview: ReactNode
  /** 復元の提案・公開に足りない項目など、言語ごとの欄の上に出すもの */
  notices: ReactNode
  settings: ReactNode
  /** 設定パネルの欄に誤りがある（「設定」ボタンに印を付ける） */
  settingsInvalid: boolean
  settingsOpen: boolean
  onSettingsOpenChange: (open: boolean) => void
  /** 引き出しを開いたときにフォーカスを移す要素（誤りの欄へ移るとき） */
  settingsInitialFocus?: () => HTMLElement | null
  /** 画面に場所を持たないもの（確認ダイアログなど） */
  children?: ReactNode
}

const settingsHeading = css({ textStyle: 'label', color: 'text.muted' })

/**
 * L5 サイドメニュー＋2ペイン編集（design-spec 4.1・4.3）。上に固定の操作バー、その下に言語ごとの欄と、表示の切り替えに
 * 合わせたエディタ・プレビュー、右に設定パネル（幅 1280px 未満は右から開く引き出し）。
 * 768px 以上は画面の高さに収め、エディタ・プレビュー・設定パネルはそれぞれの中でスクロールする。
 * エディタは表示や幅が変わっても同じ場所に描いたまま、見せる・隠すだけを変える
 * （別の要素の下へ描き直すと、エディタが作り直されて元に戻す履歴とアップロード中の画像の行き先が消える）
 */
export function SplitEditLayout({
  back,
  title,
  status,
  actions,
  view,
  onViewChange,
  tabs,
  localized,
  editors,
  lang,
  preview,
  notices,
  settings,
  settingsInvalid,
  settingsOpen,
  onSettingsOpenChange,
  settingsInitialFocus,
  children,
}: SplitEditLayoutProps) {
  useEditingView()
  const isMobile = useMediaQuery(MEDIA.mobile)
  const isWide = useMediaQuery(MEDIA.wide)
  const bilingual = view === 'bilingual'

  const settingsButton = !isWide && (
    <button
      type="button"
      onClick={() => onSettingsOpenChange(true)}
      aria-expanded={settingsOpen}
      className={button({ variant: 'outline' })}
    >
      <SettingsIcon size="sm" />
      <WideOnlyText>設定</WideOnlyText>
      {settingsInvalid && <span className={label({ tone: 'danger' })}>要確認</span>}
    </button>
  )

  const settingsContent = (
    <div className={css({ display: 'flex', flexDirection: 'column', gap: 'stack-dense' })}>{settings}</div>
  )

  return (
    <div
      className={css({
        display: 'flex',
        flexDirection: 'column',
        tablet: { h: 'dvh', overflow: 'hidden' },
      })}
    >
      <EditToolbar
        back={back}
        title={title}
        status={status}
        view={
          <SegmentGroup
            label="表示"
            items={isMobile ? MOBILE_EDITOR_VIEW_ITEMS : EDITOR_VIEW_ITEMS}
            value={view}
            onValueChange={onViewChange}
          />
        }
        actions={
          <>
            {settingsButton}
            {actions}
          </>
        }
      />
      <div className={css({ display: 'flex', flex: '1', tablet: { overflow: 'hidden' } })}>
        <div
          className={css({
            display: 'flex',
            flexDirection: 'column',
            gap: 'stack-dense',
            flex: '1',
            p: 'inset',
            // ふだんはエディタ・プレビューの中でスクロールする。通知が多く画面が低いときだけ、この列ごとスクロールする
            tablet: { overflowY: 'auto' },
          })}
        >
          {notices}
          {!bilingual && tabs}
          <div data-view={view} data-lang={lang} className={paneGrid}>
            {(['ja', 'en'] as const).map((paneLang) => (
              <div key={`fields-${paneLang}`} data-pane={`fields-${paneLang}`} hidden={!bilingual}>
                {bilingual && localized(paneLang)}
              </div>
            ))}
            {(['ja', 'en'] as const).map((paneLang) => (
              <section
                key={`editor-${paneLang}`}
                data-pane={`editor-${paneLang}`}
                aria-label={`本文（${paneLang === 'ja' ? '日本語' : '英語'}）`}
                hidden={view === 'preview' || (!bilingual && paneLang !== lang)}
              >
                {editors[paneLang]}
              </section>
            ))}
            <section data-pane="preview" aria-label="プレビュー" hidden={view === 'write' || bilingual}>
              {preview}
            </section>
          </div>
        </div>
        {isWide && (
          <aside
            aria-labelledby="settings-heading"
            className={css({
              w: 'settings-panel',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 'stack-dense',
              overflowY: 'auto',
              p: 'inset',
              borderLeftWidth: 'default',
              borderLeftStyle: 'solid',
              borderLeftColor: 'border.default',
            })}
          >
            <h2 id="settings-heading" className={settingsHeading}>
              設定
            </h2>
            {settingsContent}
          </aside>
        )}
      </div>
      {!isWide && (
        <Dialog
          open={settingsOpen}
          onOpenChange={onSettingsOpenChange}
          title="設定"
          closeLabel="閉じる"
          placement="end"
          keepMounted
          initialFocusEl={settingsInitialFocus}
        >
          {settingsContent}
        </Dialog>
      )}
      {children}
    </div>
  )
}

/**
 * エディタ・プレビューの並べ方（design-spec 6.7 の「表示の切り替え」）。言語ごとの欄（日英）・エディタ（日英）・プレビューを
 * 同じ親の子として描き続け、表示ごとに置き場所（grid-area）と見せる・隠すだけを変える
 */
const paneGrid = css({
  display: 'grid',
  gap: 'stack-dense',
  flex: '1',
  gridTemplateColumns: 'minmax(0, 1fr)',
  // 画面が低くても、エディタは最小の高さを保つ（足りなければ外の列がスクロールする）
  tablet: { gridTemplateRows: 'minmax(0, 1fr)', overflow: 'hidden', minH: 'editor' },
  '& > [hidden]': { display: 'none' },
  '& > [data-pane]': { display: 'flex', flexDirection: 'column', gap: 'inline', tablet: { overflow: 'hidden' } },
  '&[data-view=split]': {
    tablet: { gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' },
  },
  '&[data-view=bilingual]': {
    gridTemplateAreas: '"fields-ja" "editor-ja" "fields-en" "editor-en"',
    tablet: {
      gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
      gridTemplateRows: 'auto minmax(0, 1fr)',
      gridTemplateAreas: '"fields-ja fields-en" "editor-ja editor-en"',
    },
    '& > [data-pane=fields-ja]': { gridArea: 'fields-ja' },
    '& > [data-pane=fields-en]': { gridArea: 'fields-en' },
    '& > [data-pane=editor-ja]': { gridArea: 'editor-ja' },
    '& > [data-pane=editor-en]': { gridArea: 'editor-en' },
  },
})

/** 「日英」の言語ごとの見出しと欄 */
export function LocalizedColumn({ heading, children }: { heading: ReactNode; children: ReactNode }) {
  return (
    <div className={css({ display: 'flex', flexDirection: 'column', gap: 'stack-dense' })}>
      <h2 className={css({ display: 'flex', alignItems: 'center', gap: 'inline', textStyle: 'ui' })}>{heading}</h2>
      {children}
    </div>
  )
}

/** 読み込み中の L5（design-spec 6.7.4）。L5 の形のスケルトンで描き、読み込んだあとにレイアウトが跳ばないようにする */
export function SplitEditSkeleton({ back, title, actions }: Pick<EditToolbarProps, 'back' | 'title' | 'actions'>) {
  useEditingView()
  const isWide = useMediaQuery(MEDIA.wide)
  return (
    <div
      aria-busy="true"
      className={css({ display: 'flex', flexDirection: 'column', tablet: { h: 'dvh', overflow: 'hidden' } })}
    >
      <EditToolbar back={back} title={title} actions={actions} />
      <div className={css({ display: 'flex', flex: '1' })}>
        <div className={css({ display: 'flex', flexDirection: 'column', gap: 'stack-dense', flex: '1', p: 'inset' })}>
          <Skeleton className={css({ h: 'control' })} />
          <Skeleton className={css({ h: 'control' })} />
          <Skeleton className={css({ flex: '1', minH: 'editor' })} />
        </div>
        {isWide && (
          <div
            className={css({
              w: 'settings-panel',
              display: 'flex',
              flexDirection: 'column',
              gap: 'stack-dense',
              p: 'inset',
              borderLeftWidth: 'default',
              borderLeftStyle: 'solid',
              borderLeftColor: 'border.default',
            })}
          >
            {Array.from({ length: 4 }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 中身のない形だけの欄で、並びは変わらない
              <Skeleton key={index} className={css({ h: 'control' })} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---- L6 -----------------------------------------------------------------------

const FORM_VIEW_ITEMS: readonly SegmentItem<FormView>[] = [
  { value: 'single', label: '片方', icon: SingleIcon },
  { value: 'bilingual', label: '日英', icon: LanguagesIcon },
]

export interface FormLayoutProps extends EditToolbarProps {
  /** 日英の項目を持つもの（プロフィール・経歴）の表示の切り替え。持たないもの（使用技術）は省く */
  formView?: { value: FormView; onChange: (view: FormView) => void }
  children: ReactNode
}

/** L6 サイドメニュー＋フォーム。上に固定の操作バー、その下に1列のフォーム（「日英」は言語ごとの欄を左右に並べる） */
export function FormLayout({ back, title, status, actions, formView, children }: FormLayoutProps) {
  useEditingView()
  return (
    <div className={css({ display: 'flex', flexDirection: 'column' })}>
      <EditToolbar
        back={back}
        title={title}
        status={status}
        view={
          formView && (
            <SegmentGroup
              label="表示"
              items={FORM_VIEW_ITEMS}
              value={formView.value}
              onValueChange={formView.onChange}
            />
          )
        }
        actions={actions}
      />
      <div
        data-wide={formView?.value === 'bilingual'}
        className={css({
          display: 'flex',
          flexDirection: 'column',
          gap: 'stack-dense',
          p: 'inset',
          maxW: 'content',
          '&[data-wide=true]': { maxW: 'unset' },
        })}
      >
        {children}
      </div>
    </div>
  )
}

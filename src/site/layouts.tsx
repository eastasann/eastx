/**
 * 公開側のレイアウト（design-spec 4.1）。ヘッダーとフッターは SiteChrome が持ち、L1・L2 はその間の1列を作る。
 * 1列は画面幅が広くても読みやすい幅のまま中央に置く
 */
import { createContext, type ReactNode, useContext } from 'react'
import { css, cx } from 'styled-system/css'
import type { SiteChromeView } from '~/content/site-chrome'
import type { Lang } from '~/i18n/detect'
import type { Messages } from '~/i18n/messages'
import { StackIconToneFilter } from './content-parts'
import { useScrollToStateSection } from './section-scroll'
import { SiteFooter } from './site-footer'
import { SiteHeader } from './site-header'

export interface SiteChromeProps {
  lang: Lang
  chrome: SiteChromeView
  messages: Messages
  children: ReactNode
}

const InsideChrome = createContext(false)

/** 公開側の全画面（P1〜P6・C1・C2）で共通のヘッダーとフッター。どれも列の幅（size.site-column）に揃える */
export function SiteChrome({ lang, chrome, messages, children }: SiteChromeProps) {
  // C1・C2 は、ルーターが `$lang` のレイアウトの中（Outlet）に描くとき（子のルートが当たらない・子が失敗した）と、
  // レイアウトの代わりに描くとき（`$lang` 自身が notFound・失敗した）がある。中に描かれたときは二重にしない
  const inside = useContext(InsideChrome)
  if (inside) return children
  return (
    <InsideChrome.Provider value={true}>
      <div className={css({ display: 'flex', flexDirection: 'column', minH: 'dvh' })}>
        <StackIconToneFilter />
        <SiteHeader lang={lang} messages={messages} />
        <main className={css({ flex: '1' })}>{children}</main>
        <SiteFooter lang={lang} chrome={chrome} messages={messages} />
      </div>
    </InsideChrome.Provider>
  )
}

const column = css({
  display: 'flex',
  flexDirection: 'column',
  maxW: 'site-column',
  mx: 'auto',
  px: 'gutter',
})

/** L1 シングルカラム・ロングページ。セクションを縦に積む。ヘッダーから最初の中身までは詰める（design-spec 6.1.1） */
export function SingleColumnLayout({ children }: { children: ReactNode }) {
  useScrollToStateSection()
  return <div className={cx(column, css({ gap: 'section', pt: 'stack', pb: 'section' }))}>{children}</div>
}

export interface ArticleLayoutProps {
  back?: ReactNode
  title: ReactNode
  /** タイトルの下のメタ情報（期間・公開日・使用技術・外部への入口など） */
  meta?: ReactNode
  media?: ReactNode
  children: ReactNode
  footer?: ReactNode
}

/** L2 記事カラム。上から「戻るリンク → タイトルとメタ情報 → 画像 → 本文 → 前後のナビ」 */
export function ArticleLayout({ back, title, meta, media, children, footer }: ArticleLayoutProps) {
  return (
    <article className={cx(column, css({ gap: 'stack', py: 'section' }))}>
      {back}
      <header className={css({ display: 'flex', flexDirection: 'column', gap: 'stack-dense' })}>
        <h1 className={css({ textStyle: 'heading-1' })}>{title}</h1>
        {meta}
      </header>
      {media}
      <div>{children}</div>
      {footer !== undefined && (
        <footer
          className={css({
            pt: 'stack',
            borderTopWidth: 'default',
            borderTopStyle: 'solid',
            borderTopColor: 'border.default',
          })}
        >
          {footer}
        </footer>
      )}
    </article>
  )
}

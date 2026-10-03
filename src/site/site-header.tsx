/**
 * 公開側のヘッダー（design-spec 6.1.2）。スクロール中も上部に固定し、モバイル幅ではセクションメニューをメニューボタンにまとめる
 */
import { Link, useLocation, useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { css, cva, cx } from 'styled-system/css'
import type { SectionId } from '~/content/site-chrome'
import { LANGS, type Lang } from '~/i18n/detect'
import type { Messages } from '~/i18n/messages'
import { MenuIcon } from '~/ui/icons'
import { Menu } from '~/ui/menu'
import { isPlainClick } from '~/ui/navigation'
import { LANG_COOKIE, writePreferenceCookie } from '~/ui/preferences'
import { button } from '~/ui/recipes'
import { ThemeToggle } from '~/ui/theme'
import { visibleSection } from './section-scroll'

export interface SiteHeaderProps {
  lang: Lang
  /** 出すセクション（中身が1件以上のもの） */
  sections: SectionId[]
  messages: Messages
}

const header = css({
  position: 'sticky',
  top: 'none',
  zIndex: 'header',
  display: 'flex',
  alignItems: 'center',
  gap: 'inline',
  h: 'header',
  px: 'gutter',
  bg: 'bg.canvas',
  borderBottomWidth: 'default',
  borderBottomStyle: 'solid',
  borderBottomColor: 'border.default',
})

const navLink = cva({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    h: 'control',
    px: 'inset-dense',
    textStyle: 'ui',
    whiteSpace: 'nowrap',
    textDecoration: 'none',
  },
  variants: {
    /** 今の言語は強調し、押せる見た目にしない */
    current: {
      false: { color: 'text.default', _hover: { color: 'accent.hover' } },
      true: { color: 'accent.default', textDecoration: 'underline' },
    },
  },
  defaultVariants: { current: false },
})

export function SiteHeader({ lang, sections, messages }: SiteHeaderProps) {
  const router = useRouter()
  const location = useLocation()
  const isTop = location.pathname === `/${lang}` || location.pathname === `/${lang}/`
  const { navRef, listRef, overflowing } = useOverflow()

  return (
    <header className={header}>
      <Link
        to="/$lang"
        params={{ lang }}
        activeOptions={{ exact: true }}
        onClick={() => {
          // トップの中ではページを移らず先頭へ戻す（design-spec 6.1.2）
          if (isTop) window.scrollTo({ top: 0 })
        }}
        className={css({ textStyle: 'heading-3', color: 'text.default', textDecoration: 'none', flexShrink: 0 })}
      >
        {messages.siteName}
      </Link>

      {sections.length > 0 && (
        // タブレット幅で入りきらないときはメニューボタンにまとめる（design-spec 4.3）。
        // 入りきるかを測り続けるため、隠すときも場所は残す（visibility）
        <nav
          ref={navRef}
          aria-label={messages.header.sectionNav}
          aria-hidden={overflowing || undefined}
          className={cx(
            css({ hideBelow: 'tablet', flex: '1', overflow: 'hidden' }),
            overflowing && css({ visibility: 'hidden' }),
          )}
        >
          <ul ref={listRef} className={css({ display: 'flex', w: 'max-content' })}>
            {sections.map((id) => (
              <li key={id}>
                <Link
                  to="/$lang"
                  params={{ lang }}
                  hash={id}
                  activeOptions={{ exact: true, includeHash: true }}
                  className={navLink()}
                >
                  {messages.section[id]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div className={css({ display: 'flex', alignItems: 'center', gap: 'inline', ml: 'auto' })}>
        <LanguageSwitch lang={lang} messages={messages} />
        <ThemeToggle labels={messages.theme} />
        {sections.length > 0 && (
          <div className={overflowing ? undefined : css({ hideFrom: 'tablet' })}>
            <Menu
              trigger={<MenuIcon />}
              triggerLabel={messages.header.menu}
              triggerClassName={button({ variant: 'ghost', shape: 'icon' })}
              items={sections.map((id) => ({
                value: id,
                label: messages.section[id],
                href: `/${lang}#${id}`,
                onClick: (event) => {
                  if (!isPlainClick(event)) return
                  event.preventDefault()
                  void router.navigate({ to: '/$lang', params: { lang }, hash: id })
                },
              }))}
            />
          </div>
        )}
      </div>
    </header>
  )
}

/** セクションメニューの並び（ul）が、置き場所（nav）の幅に入りきらないか。幅が変わるたびに測り直す */
function useOverflow() {
  const navRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  useEffect(() => {
    const nav = navRef.current
    const list = listRef.current
    if (!nav || !list) return
    const measure = () => setOverflowing(list.offsetWidth > nav.clientWidth)
    const observer = new ResizeObserver(measure)
    observer.observe(nav)
    observer.observe(list)
    measure()
    return () => observer.disconnect()
  }, [])
  return { navRef, listRef, overflowing }
}

/**
 * 「JA ｜ EN」。同じ画面を URL の言語の部分だけ変えて開き直し、選んだ言語を Cookie に覚える（design-spec 1.4）。
 * トップでは、表示中のセクションを history state で渡す（SDD 4.1）
 */
function LanguageSwitch({ lang, messages }: { lang: Lang; messages: Messages }) {
  const router = useRouter()
  const location = useLocation()
  const rest = location.pathname.replace(/^\/[^/]*/, '')
  const hash = location.hash === '' ? '' : `#${location.hash}`
  const isTop = rest === '' || rest === '/'

  return (
    // biome-ignore lint/a11y/useSemanticElements: 言語の選択肢をまとめて読み上げる。fieldset はフォームの部品ではないので使わない
    <div role="group" aria-label={messages.header.language} className={css({ display: 'flex', alignItems: 'center' })}>
      {LANGS.map((target, index) => {
        const text = target.toUpperCase()
        const separator = index > 0 && (
          <span aria-hidden="true" className={css({ color: 'text.muted', textStyle: 'ui' })}>
            ｜
          </span>
        )
        if (target === lang) {
          return (
            <span key={target} className={css({ display: 'contents' })}>
              {separator}
              <span aria-current="true" lang={target} className={navLink({ current: true })}>
                {text}
              </span>
            </span>
          )
        }
        const href = `/${target}${rest}${location.searchStr}${hash}`
        return (
          <span key={target} className={css({ display: 'contents' })}>
            {separator}
            <a
              href={href}
              hrefLang={target}
              lang={target}
              className={navLink()}
              onClick={(event) => {
                writePreferenceCookie(LANG_COOKIE, target)
                if (!isPlainClick(event)) return
                event.preventDefault()
                const section = isTop ? visibleSection() : undefined
                void router.navigate({ href, state: section === undefined ? undefined : { section } })
              }}
            >
              {text}
            </a>
          </span>
        )
      })}
    </div>
  )
}

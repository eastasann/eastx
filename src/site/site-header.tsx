/**
 * 公開側のヘッダー（design-spec 6.1.2）。ドメイン名と、言語・テーマの切り替えだけを置き、固定しない
 */
import { Link, useLocation, useRouter } from '@tanstack/react-router'
import { css, cva } from 'styled-system/css'
import { LANGS, type Lang } from '~/i18n/detect'
import type { Messages } from '~/i18n/messages'
import { isPlainClick } from '~/ui/navigation'
import { LANG_COOKIE, writePreferenceCookie } from '~/ui/preferences'
import { ThemeToggle } from '~/ui/theme'
import { track } from './analytics'

export interface SiteHeaderProps {
  lang: Lang
  messages: Messages
}

const header = css({
  display: 'flex',
  alignItems: 'center',
  gap: 'inline',
  h: 'header',
  w: '[100%]',
  maxW: 'site-column',
  mx: 'auto',
  px: 'gutter',
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
      false: { color: 'text.muted', _hover: { color: 'text.default' } },
      true: { color: 'accent.default', textDecoration: 'underline' },
    },
  },
  defaultVariants: { current: false },
})

export function SiteHeader({ lang, messages }: SiteHeaderProps) {
  const location = useLocation()
  const isTop = location.pathname === `/${lang}` || location.pathname === `/${lang}/`

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
        className={css({
          textStyle: 'meta',
          color: 'text.muted',
          textDecoration: 'none',
          flexShrink: 0,
          _hover: { color: 'text.default' },
        })}
      >
        {messages.siteDomain}
      </Link>
      <div className={css({ display: 'flex', alignItems: 'center', gap: 'inline', ml: 'auto' })}>
        <LanguageSwitch lang={lang} messages={messages} />
        <ThemeToggle labels={messages.theme} onSwitch={(to) => track({ type: 'theme_switch', to })} />
      </div>
    </header>
  )
}

/**
 * 「JA ｜ EN」。同じ画面を URL の言語の部分だけ変えて開き直し、選んだ言語を Cookie に覚える（design-spec 1.4）
 */
function LanguageSwitch({ lang, messages }: { lang: Lang; messages: Messages }) {
  const router = useRouter()
  const location = useLocation()
  const rest = location.pathname.replace(/^\/[^/]*/, '')

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
        // ハッシュは引き継がない。切り替えた先はページの一番上から始める（design-spec 1.4）
        const href = `/${target}${rest}${location.searchStr}`
        return (
          <span key={target} className={css({ display: 'contents' })}>
            {separator}
            <a
              href={href}
              hrefLang={target}
              lang={target}
              className={navLink()}
              onClick={(event) => {
                track({ type: 'lang_switch', to: target })
                writePreferenceCookie(LANG_COOKIE, target)
                if (!isPlainClick(event)) return
                event.preventDefault()
                void router.navigate({ href })
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

import { createRootRoute, HeadContent, Scripts, useMatch, useRouterState } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { EMPTY_SITE_CHROME } from '~/content/site-chrome'
import { getMessages } from '~/i18n/messages'
import { SiteChrome } from '~/site/layouts'
import { NotFoundPage } from '~/site/status-pages'
import appCss from '~/styles/index.css?url'
import { readPreferredLang, readThemePreference, THEME_INIT_SCRIPT } from '~/ui/preferences'
import { ThemeProvider } from '~/ui/theme'

export const Route = createRootRoute({
  // 表示設定は SSR でもブラウザでも同じ値から描くため、リクエスト（ブラウザでは document.cookie）から読む
  beforeLoad: () => ({ theme: readThemePreference(), preferredLang: readPreferredLang() }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'eastasian' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  notFoundComponent: RootNotFound,
  shellComponent: RootDocument,
})

/**
 * どのルートにも当たらないパスの受け皿（SDD 4.1）。公開側のパスは `$lang` が受けるので、ここに来るのは
 * `$lang` の外で見つからないときだけ。ヘッダーとフッターの中身は読んでいないので、セクションと SNS は出さない
 */
function RootNotFound() {
  const { preferredLang } = Route.useRouteContext()
  const messages = getMessages(preferredLang)
  return (
    <SiteChrome lang={preferredLang} chrome={EMPTY_SITE_CHROME} messages={messages}>
      <NotFoundPage lang={preferredLang} messages={messages} />
    </SiteChrome>
  )
}

/** <html lang> は URL の言語（SDD 9章）。URL に言語がない C1 は `$lang` が決めた表示の言語、管理画面は日本語 */
function useDocumentLang(): string {
  const langMatch = useMatch({ from: '/$lang', shouldThrow: false })
  const isAdmin = useRouterState({ select: (state) => state.location.pathname.startsWith('/admin') })
  const { preferredLang } = Route.useRouteContext()
  if (langMatch) return langMatch.context.lang
  return isAdmin ? 'ja' : preferredLang
}

function RootDocument({ children }: { children: ReactNode }) {
  const { theme } = Route.useRouteContext()
  const lang = useDocumentLang()
  return (
    // data-theme は <head> のスクリプトが描画の前に入れるので、サーバーの HTML とは違ってよい
    <html lang={lang} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: 中身は固定の文字列（THEME_INIT_SCRIPT）だけ */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        <ThemeProvider initial={theme}>{children}</ThemeProvider>
        <Scripts />
      </body>
    </html>
  )
}

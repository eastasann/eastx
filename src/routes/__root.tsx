import { createRootRoute, HeadContent, Scripts, useParams } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { css } from 'styled-system/css'
import { isLang } from '~/i18n/detect'
import appCss from '~/styles/index.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'eastasian' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  notFoundComponent: NotFound,
  shellComponent: RootDocument,
})

// C1（見つからないページ）の画面は Step 5 で作る。ここでは HTTP 404 の確認に足る表示だけ
function NotFound() {
  return (
    <main className={css({ p: 'section', bg: 'bg.canvas', color: 'text.default' })}>
      <h1 className={css({ textStyle: 'heading-1' })}>404 Not Found</h1>
    </main>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  // <html lang> は URL の言語（SDD 9章）。URL に言語がない画面（C1 など）の言語の決め方は
  // C1 を作る Step 5 で design-spec 3.1 に合わせる
  const { lang } = useParams({ strict: false })
  return (
    <html lang={isLang(lang) ? lang : 'ja'}>
      <head>
        <HeadContent />
      </head>
      <body className={css({ bg: 'bg.canvas', color: 'text.default' })}>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

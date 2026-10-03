/**
 * C1 見つからないページ・C2 エラー（design-spec 3.1）。どちらも L2 記事カラムで、ヘッダーとフッターの中に出す
 */
import { ErrorComponent, type ErrorComponentProps, Link, useMatch } from '@tanstack/react-router'
import { css, cx } from 'styled-system/css'
import { EMPTY_SITE_CHROME } from '~/content/site-chrome'
import type { Lang } from '~/i18n/detect'
import { getMessages, type Messages } from '~/i18n/messages'
import { button } from '~/ui/recipes'
import { ArticleLayout, SiteChrome } from './layouts'

export function NotFoundPage({ lang, messages }: { lang: Lang; messages: Messages }) {
  return (
    <ArticleLayout title={messages.notFound.title}>
      <div className={css({ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'stack' })}>
        <p className={css({ color: 'text.muted' })}>{messages.notFound.body}</p>
        <Link
          to="/$lang"
          params={{ lang }}
          activeOptions={{ exact: true }}
          className={cx(button({ variant: 'outline' }), css({ textDecoration: 'none' }))}
        >
          {messages.action.backToTop}
        </Link>
      </div>
    </ArticleLayout>
  )
}

export function ErrorPage({ messages }: { messages: Messages }) {
  return (
    <ArticleLayout title={messages.error.title}>
      <div className={css({ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'stack' })}>
        <p className={css({ color: 'text.muted' })}>{messages.error.body}</p>
        {/* 読み込み直しはサーバーからやり直す（SSR の取得の失敗なので、クライアントの再描画では直らない） */}
        <button type="button" onClick={() => window.location.reload()} className={button({ variant: 'outline' })}>
          {messages.action.reload}
        </button>
      </div>
    </ArticleLayout>
  )
}

/**
 * ルーターの既定の errorComponent（src/router.tsx）。TanStack Router は SSR で、失敗したルート自身の errorComponent
 * （なければこの既定）を使い、親へ上げないので、公開側の画面のルートはここで C2 を出す（SDD 4.1）。
 * `$lang` の外（管理画面）はライブラリの既定の表示のまま
 */
export function DefaultRouteError({ error }: ErrorComponentProps) {
  const match = useMatch({ from: '/$lang', shouldThrow: false })
  if (!match) return <ErrorComponent error={error} />
  const { lang } = match.context
  const messages = getMessages(lang)
  return (
    <SiteChrome lang={lang} chrome={EMPTY_SITE_CHROME} messages={messages}>
      <ErrorPage messages={messages} />
    </SiteChrome>
  )
}

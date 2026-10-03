import { createFileRoute, notFound, Outlet, useMatch } from '@tanstack/react-router'
import { getSiteChrome } from '~/content/server-fns'
import { EMPTY_SITE_CHROME, type SiteChromeView } from '~/content/site-chrome'
import { isLang } from '~/i18n/detect'
import { getMessages } from '~/i18n/messages'
import { SiteChrome } from '~/site/layouts'
import { ErrorPage, NotFoundPage } from '~/site/status-pages'

/**
 * 公開側の全画面の親（SDD 4.1）。ヘッダーとフッターの中身を読み、C1・C2 もこの中に出す。
 * `$lang` が ja・en 以外は C1（HTTP 404）で、その言語はルート `/` と同じ振り分けで決める（design-spec 3.1）
 */
export const Route = createFileRoute('/$lang')({
  beforeLoad: ({ params, context }) => ({ lang: isLang(params.lang) ? params.lang : context.preferredLang }),
  loader: async ({ params }) => {
    // 不正な言語の C1 は、ヘッダーとフッターの中身が読めなくても C1 のまま出す（C2 にしない）
    if (!isLang(params.lang)) throw notFound({ data: await getSiteChrome().catch(() => EMPTY_SITE_CHROME) })
    return getSiteChrome()
  },
  component: LangLayout,
  notFoundComponent: LangNotFound,
  errorComponent: LangError,
})

function LangLayout() {
  const { lang } = Route.useRouteContext()
  const chrome = Route.useLoaderData()
  return (
    <SiteChrome lang={lang} chrome={chrome} messages={getMessages(lang)}>
      <Outlet />
    </SiteChrome>
  )
}

/** 子が当たらない・子が notFound() を投げたときはローダーの結果、`$lang` が不正なときは notFound の data にある */
function LangNotFound({ data }: { data?: unknown }) {
  const { lang } = Route.useRouteContext()
  const match = useMatch({ from: '/$lang', shouldThrow: false })
  const chrome = (data as SiteChromeView | undefined) ?? match?.loaderData ?? EMPTY_SITE_CHROME
  const messages = getMessages(lang)
  return (
    <SiteChrome lang={lang} chrome={chrome} messages={messages}>
      <NotFoundPage lang={lang} messages={messages} />
    </SiteChrome>
  )
}

/** ヘッダーとフッターの中身の取得に失敗したとき。中身がないので、セクションと SNS は出さない */
function LangError() {
  const { lang } = Route.useRouteContext()
  const messages = getMessages(lang)
  return (
    <SiteChrome lang={lang} chrome={EMPTY_SITE_CHROME} messages={messages}>
      <ErrorPage messages={messages} />
    </SiteChrome>
  )
}

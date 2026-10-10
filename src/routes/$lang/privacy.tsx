import { createFileRoute, notFound } from '@tanstack/react-router'
import { getPrivacyPage } from '~/content/server-fns'
import { isLang } from '~/i18n/detect'
import { getMessages } from '~/i18n/messages'
import { pageHead, statusHead } from '~/site/head'
import { PrivacyPage } from '~/site/privacy-page'

// P6 プライバシー（design-spec 6.2.4）。行が無い・本文が日英とも空なら C1
export const Route = createFileRoute('/$lang/privacy')({
  loader: ({ params }) => {
    if (!isLang(params.lang)) throw notFound()
    return getPrivacyPage({ data: { lang: params.lang } })
  },
  head: ({ loaderData, match }) =>
    loaderData ? pageHead(loaderData.lang, loaderData.meta) : statusHead(match.context.lang, 'error'),
  component: PrivacyRoute,
})

function PrivacyRoute() {
  const view = Route.useLoaderData()
  return <PrivacyPage view={view} lang={view.lang} messages={getMessages(view.lang)} />
}

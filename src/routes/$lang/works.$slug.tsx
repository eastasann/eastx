import { createFileRoute, notFound } from '@tanstack/react-router'
import { getWorkDetail } from '~/content/server-fns'
import { isSlug } from '~/domain/slug'
import { isLang } from '~/i18n/detect'
import { getMessages } from '~/i18n/messages'
import { pageHead, statusHead } from '~/site/head'
import { PortfolioDetailPage } from '~/site/portfolio-detail-page'

// P2 作品詳細（design-spec 6.2）。スラッグが存在しない・非公開・詳細本文がないときは C1
export const Route = createFileRoute('/$lang/works/$slug')({
  loader: ({ params }) => {
    // スラッグの形でない URL は、読みに行かずに C1 にする（サーバー関数の入力の検証で C2 にしない）
    if (!isLang(params.lang) || !isSlug(params.slug)) throw notFound()
    return getWorkDetail({ data: { lang: params.lang, slug: params.slug } })
  },
  head: ({ loaderData, match }) =>
    loaderData ? pageHead(loaderData.lang, loaderData.meta) : statusHead(match.context.lang, 'error'),
  component: WorkDetail,
})

function WorkDetail() {
  const view = Route.useLoaderData()
  return <PortfolioDetailPage kind="works" view={view} lang={view.lang} messages={getMessages(view.lang)} />
}

import { createFileRoute, notFound } from '@tanstack/react-router'
import { getCodingLog } from '~/content/server-fns'
import { isSlug } from '~/domain/slug'
import { isLang } from '~/i18n/detect'
import { getMessages } from '~/i18n/messages'
import { pageHead, statusHead } from '~/site/head'
import { PostDetailPage } from '~/site/post-detail-page'

// P5 コーディング記録詳細（design-spec 6.3）。スラッグが存在しない・非公開のときは C1
export const Route = createFileRoute('/$lang/coding/$slug')({
  loader: ({ params }) => {
    // スラッグの形でない URL は、読みに行かずに C1 にする（サーバー関数の入力の検証で C2 にしない）
    if (!isLang(params.lang) || !isSlug(params.slug)) throw notFound()
    return getCodingLog({ data: { lang: params.lang, slug: params.slug } })
  },
  head: ({ loaderData, match }) =>
    loaderData ? pageHead(loaderData.lang, loaderData.meta) : statusHead(match.context.lang, 'error'),
  component: CodingLogDetail,
})

function CodingLogDetail() {
  const view = Route.useLoaderData()
  return <PostDetailPage kind="coding" view={view} lang={view.lang} messages={getMessages(view.lang)} />
}

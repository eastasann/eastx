import { createFileRoute, notFound } from '@tanstack/react-router'
import { getBlogPost } from '~/content/server-fns'
import { isSlug } from '~/domain/slug'
import { isLang } from '~/i18n/detect'
import { getMessages } from '~/i18n/messages'
import { pageHead, statusHead } from '~/site/head'
import { PostDetailPage } from '~/site/post-detail-page'

// P4 ブログ記事（design-spec 6.3）。スラッグが存在しない・非公開のときは C1
export const Route = createFileRoute('/$lang/blog/$slug')({
  loader: ({ params }) => {
    // スラッグの形でない URL は、読みに行かずに C1 にする（サーバー関数の入力の検証で C2 にしない）
    if (!isLang(params.lang) || !isSlug(params.slug)) throw notFound()
    return getBlogPost({ data: { lang: params.lang, slug: params.slug } })
  },
  head: ({ loaderData, match }) =>
    loaderData ? pageHead(loaderData.lang, loaderData.meta) : statusHead(match.context.lang, 'error'),
  component: BlogPostDetail,
})

function BlogPostDetail() {
  const view = Route.useLoaderData()
  return <PostDetailPage kind="blog" view={view} lang={view.lang} messages={getMessages(view.lang)} />
}

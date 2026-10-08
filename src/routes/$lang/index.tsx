import { createFileRoute, notFound } from '@tanstack/react-router'
import { css } from 'styled-system/css'
import { getTopPage } from '~/content/server-fns'
import type { BlogPostItem, CareerItem, CodingLogItem, ProjectItem, WorkItem } from '~/content/types'
import { isLang } from '~/i18n/detect'
import { getMessages } from '~/i18n/messages'
import { TechStackGroups } from '~/site/content-parts'
import { pageHead, statusHead } from '~/site/head'
import { SingleColumnLayout } from '~/site/layouts'
import { ProfileSection } from '~/site/profile-section'
import { PagedSection, SectionHeading } from '~/site/section-pager'
import { BlogPostRow, CareerRow, CodingLogRow, ProjectRow, WorkRow } from '~/site/top-items'

// P1 トップ（design-spec 6.1）。中身はページを返す前にすべて用意する（読み込み中の表示を出さない。6.1.5）
export const Route = createFileRoute('/$lang/')({
  loader: ({ params }) => {
    // 言語が ja・en 以外は `$lang` が C1 にする。ローダーは親と並んで走るので、ここでも読まずに止める
    if (!isLang(params.lang)) throw notFound()
    return getTopPage({ data: { lang: params.lang } })
  },
  head: ({ loaderData, match }) =>
    loaderData ? pageHead(loaderData.lang, loaderData.meta) : statusHead(match.context.lang, 'error'),
  component: TopPage,
})

function TopPage() {
  const view = Route.useLoaderData()
  const { lang } = view
  const messages = getMessages(lang)
  const { section } = messages
  return (
    <SingleColumnLayout>
      {view.profile ? (
        <ProfileSection profile={view.profile} lang={lang} messages={messages} />
      ) : (
        // プロフィールがないとき（データの移行か A3 の初回の保存の前。design-spec 6.1.5）も、ページの見出しは置く
        <h1 className={css({ srOnly: true })}>{messages.siteName}</h1>
      )}
      {/* 0件のセクションは出さない（design-spec 6.1.5）。PagedSection は0件なら何も描かない。
          型引数を明示するのは、renderItem の引数の型から items の型を推論できないため */}
      <PagedSection<CareerItem>
        id="career"
        title={section.career}
        items={view.careers}
        messages={messages}
        renderItem={(item) => <CareerRow item={item} lang={lang} messages={messages} />}
      />
      <PagedSection<ProjectItem>
        id="projects"
        title={section.projects}
        items={view.projects}
        messages={messages}
        renderItem={(item) => <ProjectRow item={item} lang={lang} messages={messages} />}
      />
      <PagedSection<WorkItem>
        id="works"
        title={section.works}
        items={view.works}
        messages={messages}
        renderItem={(item) => <WorkRow item={item} lang={lang} messages={messages} />}
      />
      {view.stackGroups.length > 0 && (
        <section
          id="stack"
          aria-labelledby="stack-heading"
          className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}
        >
          <SectionHeading id="stack-heading" title={section.stack} />
          <TechStackGroups groups={view.stackGroups} messages={messages} />
        </section>
      )}
      <PagedSection<BlogPostItem>
        id="blog"
        title={section.blog}
        items={view.blogPosts}
        messages={messages}
        renderItem={(item) => <BlogPostRow item={item} lang={lang} messages={messages} />}
      />
      <PagedSection<CodingLogItem>
        id="coding"
        title={section.coding}
        items={view.codingLogs}
        messages={messages}
        renderItem={(item) => <CodingLogRow item={item} lang={lang} messages={messages} />}
      />
    </SingleColumnLayout>
  )
}

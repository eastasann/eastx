/**
 * P2 作品詳細・P3 プロジェクト詳細（design-spec 6.2）。L2 記事カラムで、違いは期間（P3）と GitHub（P2）だけ
 */
import { Link } from '@tanstack/react-router'
import { css } from 'styled-system/css'
import type { Neighbor, ProjectDetailView, WorkDetailView } from '~/content/types'
import type { Lang } from '~/i18n/detect'
import { formatPeriod } from '~/i18n/format'
import type { Messages } from '~/i18n/messages'
import { ArrowLeftIcon, ArrowRightIcon } from '~/ui/icons'
import { FallbackImage } from '~/ui/image'
import { MarkdownBody } from '~/ui/markdown-body'
import { button } from '~/ui/recipes'
import { ExternalMark, StackChipList, Text } from './content-parts'
import { ArticleLayout } from './layouts'

type Kind = 'works' | 'projects'

export type PortfolioDetailProps = { lang: Lang; messages: Messages } & (
  | { kind: 'works'; view: WorkDetailView }
  | { kind: 'projects'; view: ProjectDetailView }
)

const DETAIL_ROUTES = { works: '/$lang/works/$slug', projects: '/$lang/projects/$slug' } as const

const textLink = css({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'inline',
  textStyle: 'ui',
  color: 'accent.default',
  textDecoration: 'none',
  _hover: { color: 'accent.hover', textDecoration: 'underline' },
})

const outlineLink = css(button.raw({ variant: 'outline' }), { textDecoration: 'none' })

/**
 * トップのそのセクションへ戻る。どの項目を含むページを開くかを history state で渡す（SDD 4.1）。
 * 前後のナビで別の項目に移っていれば、その項目を含むページになる（design-spec 6.1.3）
 */
function BackLink({ kind, lang, itemId, messages }: { kind: Kind; lang: Lang; itemId: string; messages: Messages }) {
  return (
    <Link to="/$lang" params={{ lang }} hash={kind} state={{ section: kind, itemId }} className={textLink}>
      <ArrowLeftIcon size="sm" />
      {messages.back[kind]}
    </Link>
  )
}

function NeighborNav({
  kind,
  lang,
  prev,
  next,
  messages,
}: {
  kind: Kind
  lang: Lang
  prev: Neighbor
  next: Neighbor
  messages: Messages
}) {
  const labels =
    kind === 'works'
      ? { prev: messages.neighbor.prevWork, next: messages.neighbor.nextWork }
      : { prev: messages.neighbor.prevProject, next: messages.neighbor.nextProject }
  const item = (neighbor: NonNullable<Neighbor>, direction: 'prev' | 'next') => (
    <Link
      to={DETAIL_ROUTES[kind]}
      params={{ lang, slug: neighbor.slug }}
      rel={direction}
      className={css({
        display: 'flex',
        flexDirection: 'column',
        gap: 'inline',
        textDecoration: 'none',
        alignItems: direction === 'prev' ? 'flex-start' : 'flex-end',
        textAlign: direction === 'prev' ? 'start' : 'end',
        ml: direction === 'next' ? 'auto' : undefined,
      })}
    >
      <span
        className={css({
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'inline',
          textStyle: 'label',
          color: 'text.muted',
        })}
      >
        {direction === 'prev' && <ArrowLeftIcon size="sm" />}
        {labels[direction]}
        {direction === 'next' && <ArrowRightIcon size="sm" />}
      </span>
      <Text text={neighbor.title} pageLang={lang} className={css({ textStyle: 'ui', color: 'accent.default' })} />
    </Link>
  )
  return (
    <nav
      aria-label={messages.neighbor.nav}
      className={css({ display: 'flex', gap: 'stack', justifyContent: 'space-between' })}
    >
      {prev && item(prev, 'prev')}
      {next && item(next, 'next')}
    </nav>
  )
}

export function PortfolioDetailPage(props: PortfolioDetailProps) {
  const { lang, messages, kind, view } = props
  const githubUrl = props.kind === 'works' ? props.view.githubUrl : null
  const notice =
    view.body.lang === lang
      ? null
      : kind === 'works'
        ? messages.notice.workBodyOnlyIn(view.body.lang)
        : messages.notice.projectBodyOnlyIn(view.body.lang)

  return (
    <ArticleLayout
      back={<BackLink kind={kind} lang={lang} itemId={view.id} messages={messages} />}
      title={<Text text={view.title} pageLang={lang} />}
      meta={
        <div className={css({ display: 'flex', flexDirection: 'column', gap: 'stack-dense' })}>
          {props.kind === 'projects' && (
            <p className={css({ textStyle: 'meta', color: 'text.muted' })}>
              {formatPeriod(lang, props.view.period.start, props.view.period.end)}
            </p>
          )}
          <StackChipList stacks={view.stacks} messages={messages} />
          {(view.linkUrl !== null || githubUrl !== null) && (
            <div className={css({ display: 'flex', flexWrap: 'wrap', gap: 'inline' })}>
              {view.linkUrl !== null && (
                <a href={view.linkUrl} target="_blank" rel="noopener noreferrer" className={outlineLink}>
                  {messages.action.visitSite}
                  <ExternalMark messages={messages} />
                </a>
              )}
              {githubUrl !== null && (
                <a href={githubUrl} target="_blank" rel="noopener noreferrer" className={outlineLink}>
                  {messages.action.github}
                  <ExternalMark messages={messages} />
                </a>
              )}
            </div>
          )}
        </div>
      }
      media={
        view.thumbnailUrl === null ? undefined : (
          <FallbackImage
            src={view.thumbnailUrl}
            alt={view.title.value}
            loading="eager"
            // 幅は記事カラム（flex の列）いっぱいに伸びる
            className={css({ aspectRatio: 'thumbnail', borderRadius: 'image' })}
          />
        )
      }
      footer={
        view.prev === null && view.next === null ? undefined : (
          <NeighborNav kind={kind} lang={lang} prev={view.prev} next={view.next} messages={messages} />
        )
      }
    >
      <div className={css({ display: 'flex', flexDirection: 'column', gap: 'stack' })}>
        {notice && (
          <p
            role="note"
            className={css({
              textStyle: 'body-sm',
              color: 'text.muted',
              bg: 'bg.subtle',
              p: 'inset',
              borderRadius: 'card',
            })}
          >
            {notice}
          </p>
        )}
        <MarkdownBody
          html={view.body.html}
          copyLabels={messages.code}
          lang={view.body.lang === lang ? undefined : view.body.lang}
        />
      </div>
    </ArticleLayout>
  )
}

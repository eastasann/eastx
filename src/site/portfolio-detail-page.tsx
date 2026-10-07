/**
 * P2 作品詳細・P3 プロジェクト詳細（design-spec 6.2）。L2 記事カラムで、違いは期間（P3）と GitHub（P2）だけ
 */
import { css } from 'styled-system/css'
import type { ProjectDetailView, WorkDetailView } from '~/content/types'
import type { Lang } from '~/i18n/detect'
import { formatPeriod } from '~/i18n/format'
import type { Messages } from '~/i18n/messages'
import { FallbackImage } from '~/ui/image'
import { MarkdownBody } from '~/ui/markdown-body'
import { button } from '~/ui/recipes'
import { ExternalMark, StackChipList, Text } from './content-parts'
import { BackLink, BodyNotice, NeighborNav } from './detail-parts'
import { ArticleLayout } from './layouts'

export type PortfolioDetailProps = { lang: Lang; messages: Messages } & (
  | { kind: 'works'; view: WorkDetailView }
  | { kind: 'projects'; view: ProjectDetailView }
)

const outlineLink = css(button.raw({ variant: 'outline' }), { textDecoration: 'none' })

export function PortfolioDetailPage(props: PortfolioDetailProps) {
  const { lang, messages, kind, view } = props
  const githubUrl = props.kind === 'works' ? props.view.githubUrl : null
  const notice = view.body.lang === lang ? null : messages.notice.bodyOnlyIn(view.body.lang)

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
          <NeighborNav kind={kind} lang={lang} before={view.prev} after={view.next} messages={messages} />
        )
      }
    >
      <div className={css({ display: 'flex', flexDirection: 'column', gap: 'stack' })}>
        {notice && <BodyNotice>{notice}</BodyNotice>}
        <MarkdownBody
          html={view.body.html}
          copyLabels={messages.code}
          lang={view.body.lang === lang ? undefined : view.body.lang}
        />
      </div>
    </ArticleLayout>
  )
}

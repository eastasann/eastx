/**
 * P4 ブログ記事・P5 コーディング記録詳細（design-spec 6.3）。L2 記事カラムで、違いはメタ情報の種類ラベルと参考リンク（P5）だけ
 */
import { css } from 'styled-system/css'
import type { BlogPostView, CodingLogView } from '~/content/types'
import type { Lang } from '~/i18n/detect'
import { formatDate } from '~/i18n/format'
import type { Messages } from '~/i18n/messages'
import { FallbackImage } from '~/ui/image'
import { MarkdownBody } from '~/ui/markdown-body'
import { label } from '~/ui/recipes'
import { ExternalMark, Text } from './content-parts'
import { BackLink, BodyNotice, NeighborNav } from './detail-parts'
import { ArticleLayout } from './layouts'

export type PostDetailProps = { lang: Lang; messages: Messages } & (
  | { kind: 'blog'; view: BlogPostView }
  | { kind: 'coding'; view: CodingLogView }
)

const metaText = css({ textStyle: 'meta', color: 'text.muted' })

export function PostDetailPage(props: PostDetailProps) {
  const { lang, messages, kind, view } = props
  const codingLog = props.kind === 'coding' ? props.view : null
  const notice =
    view.body.lang === lang
      ? null
      : kind === 'blog'
        ? messages.notice.postOnlyIn(view.body.lang)
        : messages.notice.codingLogOnlyIn(view.body.lang)

  return (
    <ArticleLayout
      trackReadComplete
      back={<BackLink kind={kind} lang={lang} itemId={view.id} messages={messages} />}
      title={<Text text={view.title} pageLang={lang} />}
      meta={
        <div className={css({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'inline' })}>
          <time dateTime={view.publishedAt} className={metaText}>
            {formatDate(lang, view.publishedAt)}
          </time>
          {view.contentUpdatedAt !== null && (
            <span className={metaText}>
              {messages.label.updated}{' '}
              <time dateTime={view.contentUpdatedAt}>{formatDate(lang, view.contentUpdatedAt)}</time>
            </span>
          )}
          {codingLog && <span className={label()}>{messages.codingLogKind[codingLog.kind]}</span>}
          {codingLog?.referenceUrl != null && (
            <span className={metaText}>
              {messages.label.reference}:{' '}
              <a
                href={codingLog.referenceUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-analytics-link="reference"
                className={css({
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'inline',
                  color: 'link.default',
                  textDecoration: 'underline',
                  textDecorationColor: 'link.underline',
                  _hover: { textDecorationColor: 'link.default' },
                  wordBreak: 'break-all',
                })}
              >
                {codingLog.referenceUrl}
                <ExternalMark messages={messages} />
              </a>
            </span>
          )}
        </div>
      }
      media={
        view.thumbnailUrl === null ? undefined : (
          <FallbackImage
            src={view.thumbnailUrl}
            alt={view.title.value}
            loading="eager"
            className={css({ aspectRatio: 'thumbnail', borderRadius: 'image' })}
          />
        )
      }
      footer={
        view.newer === null && view.older === null ? undefined : (
          <NeighborNav kind={kind} lang={lang} before={view.newer} after={view.older} messages={messages} />
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

/**
 * P6 プライバシー（design-spec 6.2.4）。L2 記事カラムで、戻るリンクと前後のナビは持たない
 * （P1 のセクションから来る画面ではなく、ヘッダーのドメイン名でトップへ戻れる）
 */
import { css } from 'styled-system/css'
import type { PrivacyPageView } from '~/content/types'
import type { Lang } from '~/i18n/detect'
import { formatDate } from '~/i18n/format'
import type { Messages } from '~/i18n/messages'
import { MarkdownBody } from '~/ui/markdown-body'
import { BodyNotice } from './detail-parts'
import { ArticleLayout } from './layouts'

export function PrivacyPage({ view, lang, messages }: { view: PrivacyPageView; lang: Lang; messages: Messages }) {
  return (
    <ArticleLayout
      title={messages.privacy.title}
      meta={
        <p className={css({ textStyle: 'meta', color: 'text.muted' })}>
          {messages.privacy.lastUpdated} <time dateTime={view.updatedAt}>{formatDate(lang, view.updatedAt)}</time>
        </p>
      }
    >
      <div className={css({ display: 'flex', flexDirection: 'column', gap: 'stack' })}>
        {view.body.lang !== lang && <BodyNotice>{messages.notice.pageOnlyIn(view.body.lang)}</BodyNotice>}
        <MarkdownBody
          html={view.body.html}
          copyLabels={messages.code}
          lang={view.body.lang === lang ? undefined : view.body.lang}
        />
      </div>
    </ArticleLayout>
  )
}

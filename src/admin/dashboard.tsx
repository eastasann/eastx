/**
 * A2 ダッシュボード（design-spec 6.5、SDD 5.4）。昨日までの7日の解析の要約、種類ごとの件数、新規作成の近道、下書きの一覧、
 * 公開サイトへのリンク
 */
import { useQuery } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { css, cx } from 'styled-system/css'
import type { z } from 'zod'
import type { dashboardOutput, draftTypeSchema } from '~/api/contract/dashboard'
import { formatAdminDate } from '~/i18n/format'
import { ArrowRightIcon, ExternalLinkIcon, PlusIcon } from '~/ui/icons'
import { button, card } from '~/ui/recipes'
import { formatCount } from './analytics-labels'
import { api } from './api'
import { displayTitle, SECTION_LABELS } from './labels'
import { ListLayout } from './layouts'
import { AdminLink } from './link'
import { LoadError, Skeleton } from './states'

type DraftType = z.infer<typeof draftTypeSchema>
type Counts = z.infer<typeof dashboardOutput>['counts']
type AnalyticsSummary = z.infer<typeof dashboardOutput>['analytics']

/** 下書きの一覧に出す最大の件数（design-spec 6.5） */
const MAX_DRAFTS = 10

/** 種類ごとの一覧ビューの URL（SDD 4.1） */
const LIST_HREFS: Record<DraftType, string> = {
  career: '/admin/careers',
  project: '/admin/projects',
  work: '/admin/works',
  'blog-post': '/admin/blog',
  'coding-log': '/admin/coding',
}

const TYPE_LABELS: Record<DraftType, string> = {
  career: SECTION_LABELS.career,
  project: SECTION_LABELS.projects,
  work: SECTION_LABELS.works,
  'blog-post': SECTION_LABELS.blog,
  'coding-log': SECTION_LABELS.coding,
}

/** 件数カードの並び（サイドメニューと同じ。design-spec 3.3） */
const CARDS: ({ type: DraftType; countKey: Exclude<keyof Counts, 'stacks'> } | { type: 'stack' })[] = [
  { type: 'career', countKey: 'careers' },
  { type: 'project', countKey: 'projects' },
  { type: 'work', countKey: 'works' },
  { type: 'stack' },
  { type: 'blog-post', countKey: 'blogPosts' },
  { type: 'coding-log', countKey: 'codingLogs' },
]

const cardLink = css({ color: 'text.default', textDecoration: 'none', _hover: { textDecoration: 'underline' } })
/** カード全体を押せるようにする。見出しのリンクの ::after をカードいっぱいに広げる（design-spec 6.5） */
const stretchedLink = css({ _after: { content: '""', position: 'absolute', inset: 'none' } })
/** 下書きの件数のリンクは、広げた見出しのリンクの上に重ねて、こちらを押せるようにする */
const countLink = css({
  position: 'relative',
  color: 'link.default',
  textDecoration: 'underline',
  textDecorationColor: 'link.underline',
  _hover: { textDecorationColor: 'link.default' },
})
const countText = css({ textStyle: 'body-sm', fontVariantNumeric: 'tabular-nums' })

function CountCards({ counts }: { counts: Counts | undefined }) {
  return (
    <ul aria-label="種類ごとの件数" className={css({ display: 'flex', flexWrap: 'wrap', gap: 'inline' })}>
      {CARDS.map((entry) => {
        const title = entry.type === 'stack' ? SECTION_LABELS.stack : TYPE_LABELS[entry.type]
        const href = entry.type === 'stack' ? '/admin/stacks' : LIST_HREFS[entry.type]
        return (
          <li
            key={entry.type}
            className={css(card.raw({ interactive: true }), {
              position: 'relative',
              flex: '1',
              minW: 'thumbnail-card',
            })}
          >
            <AdminLink href={href} className={cx(cardLink, stretchedLink, css({ textStyle: 'heading-3' }))}>
              {title}
            </AdminLink>
            {counts === undefined ? (
              <Skeleton />
            ) : entry.type === 'stack' ? (
              <p className={countText}>{counts.stacks.total}件</p>
            ) : (
              <div className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}>
                <p className={countText}>公開 {counts[entry.countKey].published}</p>
                <p className={countText}>
                  <AdminLink href={`${href}?status=draft`} className={countLink}>
                    下書き {counts[entry.countKey].draft}
                  </AdminLink>
                </p>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** 昨日までの7日の要約の1行。リンクは A10 の7日（design-spec 6.5） */
function AnalyticsLine({ analytics }: { analytics: AnalyticsSummary | undefined }) {
  if (analytics === undefined) return <Skeleton className={css({ maxW: 'popover' })} />
  return (
    <p
      className={css({
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 'stack-dense',
        rowGap: 'inline',
        textStyle: 'body-sm',
      })}
    >
      <span className={css({ color: 'text.muted' })}>昨日までの7日</span>
      <span className={css({ fontVariantNumeric: 'tabular-nums' })}>
        閲覧 {formatCount(analytics.pageViews)}・訪問者 {formatCount(analytics.visitors)}
        {!analytics.measuring && <span className={css({ color: 'text.muted' })}>（この環境では計測していません）</span>}
      </span>
      <AdminLink
        href="/admin/analytics?range=7d"
        className={css({
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'inline-tight',
          color: 'link.default',
          textDecoration: 'underline',
          textDecorationColor: 'link.underline',
          _hover: { textDecorationColor: 'link.default' },
        })}
      >
        アクセス解析を見る
        <ArrowRightIcon size="sm" />
      </AdminLink>
    </p>
  )
}

const cell = css({
  textAlign: 'start',
  px: 'inset-dense',
  py: 'inset-dense',
  borderBottomWidth: 'default',
  borderBottomStyle: 'solid',
  borderBottomColor: 'border.default',
})

export function DashboardPage() {
  const router = useRouter()
  const query = useQuery({ queryKey: ['dashboard'], queryFn: () => api.dashboard.get() })
  const drafts = query.data?.drafts

  return (
    <ListLayout
      title="ダッシュボード"
      actions={
        <a
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className={cx(button({ variant: 'outline' }), css({ textDecoration: 'none' }))}
        >
          公開サイトを見る
          <ExternalLinkIcon size="sm" />
          <span className={css({ srOnly: true })}>（別タブで開く）</span>
        </a>
      }
    >
      <div className={css({ display: 'flex', flexDirection: 'column', gap: 'stack-dense' })}>
        {query.status === 'error' ? (
          <LoadError onRetry={() => query.refetch()} />
        ) : (
          <>
            <AnalyticsLine analytics={query.data?.analytics} />
            <CountCards counts={query.data?.counts} />
            <div className={css({ display: 'flex', flexWrap: 'wrap', gap: 'inline' })}>
              <AdminLink
                href="/admin/blog/new"
                className={cx(button({ variant: 'outline' }), css({ textDecoration: 'none' }))}
              >
                <PlusIcon size="sm" />
                ブログを書く
              </AdminLink>
              <AdminLink
                href="/admin/coding/new"
                className={cx(button({ variant: 'outline' }), css({ textDecoration: 'none' }))}
              >
                <PlusIcon size="sm" />
                記録を書く
              </AdminLink>
            </div>
            <section
              aria-labelledby="drafts-heading"
              className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}
            >
              <h2 id="drafts-heading" className={css({ textStyle: 'heading-2' })}>
                下書き
              </h2>
              {drafts === undefined ? (
                <div aria-busy="true" className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}>
                  <Skeleton />
                  <Skeleton />
                  <Skeleton />
                </div>
              ) : drafts.items.length === 0 ? (
                <p className={css({ textStyle: 'body-sm', color: 'text.muted' })}>下書きはありません</p>
              ) : (
                <>
                  <table className={css({ w: '[100%]', borderCollapse: 'collapse', textStyle: 'body-sm' })}>
                    <thead>
                      <tr>
                        <th className={cx(cell, css({ textStyle: 'label', color: 'text.muted' }))}>種類</th>
                        <th className={cx(cell, css({ textStyle: 'label', color: 'text.muted' }))}>タイトル</th>
                        <th className={cx(cell, css({ textStyle: 'label', color: 'text.muted' }))}>最終保存日</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drafts.items.slice(0, MAX_DRAFTS).map((item) => {
                        const href = `${LIST_HREFS[item.type]}/${item.id}`
                        return (
                          <tr
                            key={`${item.type}:${item.id}`}
                            onClick={(event) => {
                              if (!(event.target instanceof Element && event.target.closest('a')))
                                void router.navigate({ href })
                            }}
                            className={css({ cursor: 'pointer', _hover: { bg: 'bg.subtle' } })}
                          >
                            <td className={cell}>{TYPE_LABELS[item.type]}</td>
                            <td className={cell}>
                              <AdminLink href={href} className={cardLink}>
                                {displayTitle(item.title)}
                              </AdminLink>
                            </td>
                            <td className={cx(cell, css({ fontVariantNumeric: 'tabular-nums' }))}>
                              {formatAdminDate(item.updatedAt)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {drafts.total > MAX_DRAFTS && (
                    <p className={css({ textStyle: 'body-sm', color: 'text.muted' })}>
                      残りは各一覧の下書きで絞り込んで見る
                    </p>
                  )}
                </>
              )}
            </section>
          </>
        )}
      </div>
    </ListLayout>
  )
}

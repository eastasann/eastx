/**
 * 詳細ページ（P2〜P5。design-spec 6.2・6.3）で共通の部品: 戻るリンク・前後のナビ・本文の言語の注記
 */
import { Link } from '@tanstack/react-router'
import { css, cx } from 'styled-system/css'
import type { Neighbor } from '~/content/types'
import type { Lang } from '~/i18n/detect'
import type { Messages } from '~/i18n/messages'
import { ArrowLeftIcon, ArrowRightIcon } from '~/ui/icons'
import { Text } from './content-parts'
import type { PagedSectionId } from './history-state'

/** 詳細ページを持つセクション。戻るリンクの行き先（トップのセクションの ID）を兼ねる */
export type DetailKind = Exclude<PagedSectionId, 'career'>

const DETAIL_ROUTES = {
  works: '/$lang/works/$slug',
  projects: '/$lang/projects/$slug',
  blog: '/$lang/blog/$slug',
  coding: '/$lang/coding/$slug',
} as const

const textLink = css({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'inline',
  textStyle: 'ui',
  color: 'link.default',
  textDecoration: 'none',
  _hover: { textDecoration: 'underline' },
})

/**
 * トップのそのセクションへ戻る。どの項目を含むページを開くかを history state で渡す（SDD 4.1）。
 * 前後のナビで別の項目に移っていれば、その項目を含むページになる（design-spec 6.1.3）
 */
export function BackLink({
  kind,
  lang,
  itemId,
  messages,
}: {
  kind: DetailKind
  lang: Lang
  itemId: string
  messages: Messages
}) {
  return (
    <Link to="/$lang" params={{ lang }} hash={kind} state={{ section: kind, itemId }} className={textLink}>
      <ArrowLeftIcon size="sm" />
      {messages.back[kind]}
    </Link>
  )
}

/** 左右の見出し。作品・プロジェクトは表示順の前後、ブログ・コーディング記録は公開日の新しい・古い */
function neighborLabels(kind: DetailKind, messages: Messages): { before: string; after: string } {
  const { neighbor } = messages
  switch (kind) {
    case 'works':
      return { before: neighbor.prevWork, after: neighbor.nextWork }
    case 'projects':
      return { before: neighbor.prevProject, after: neighbor.nextProject }
    case 'blog':
      return { before: neighbor.newerPost, after: neighbor.olderPost }
    case 'coding':
      return { before: neighbor.newerLog, after: neighbor.olderLog }
  }
}

/**
 * 前後のナビ。`before` は左（一覧で前に並ぶもの。ブログ・コーディング記録では新しいもの）、`after` は右。
 * 両方とも無ければ何も出さない
 */
export function NeighborNav({
  kind,
  lang,
  before,
  after,
  messages,
}: {
  kind: DetailKind
  lang: Lang
  before: Neighbor
  after: Neighbor
  messages: Messages
}) {
  const labels = neighborLabels(kind, messages)
  const item = (neighbor: NonNullable<Neighbor>, direction: 'before' | 'after') => (
    <Link
      to={DETAIL_ROUTES[kind]}
      params={{ lang, slug: neighbor.slug }}
      rel={direction === 'before' ? 'prev' : 'next'}
      // group: ホバーでタイトルにだけ下線を引く（_groupHover）
      className={cx(
        'group',
        css({
          display: 'flex',
          flexDirection: 'column',
          gap: 'inline',
          textDecoration: 'none',
          alignItems: direction === 'before' ? 'flex-start' : 'flex-end',
          textAlign: direction === 'before' ? 'start' : 'end',
          ml: direction === 'after' ? 'auto' : undefined,
        }),
      )}
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
        {direction === 'before' && <ArrowLeftIcon size="sm" />}
        {labels[direction]}
        {direction === 'after' && <ArrowRightIcon size="sm" />}
      </span>
      <Text
        text={neighbor.title}
        pageLang={lang}
        className={css({ textStyle: 'ui', color: 'link.default', _groupHover: { textDecoration: 'underline' } })}
      />
    </Link>
  )
  return (
    <nav
      aria-label={messages.neighbor.nav}
      className={css({ display: 'flex', gap: 'stack', justifyContent: 'space-between' })}
    >
      {before && item(before, 'before')}
      {after && item(after, 'after')}
    </nav>
  )
}

/** 本文が表示中の言語でないときの注記（design-spec 6.2.3・6.3） */
export function BodyNotice({ children }: { children: string }) {
  return (
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
      {children}
    </p>
  )
}

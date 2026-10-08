/**
 * トップのセクションの1件の表示（design-spec 6.1.3・6.1.4）。どの項目も1行の行で、経歴・作品・プロジェクトは
 * 行全体のボタンでその場に中身を広げ、行き先への入口は広げた中に置く。行は左に名前（閉じているあいだは
 * はみ出したら「…」で切る）、右にメタ（切らない）
 */
import { Link } from '@tanstack/react-router'
import { type ReactNode, useId, useState } from 'react'
import { css, cva, cx } from 'styled-system/css'
import type { LocalizedText } from '~/content/localize'
import type { BlogPostItem, CareerItem, CodingLogItem, ProjectItem, StackChip, WorkItem } from '~/content/types'
import type { Lang } from '~/i18n/detect'
import { formatDate, formatPeriod } from '~/i18n/format'
import type { Messages } from '~/i18n/messages'
import { ArrowRightIcon, ChevronDownIcon, ChevronRightIcon } from '~/ui/icons'
import { FallbackImage } from '~/ui/image'
import { MarkdownBody } from '~/ui/markdown-body'
import { ExternalMark, LanguageLabel, MAX_ROW_STACKS, StackIconRow, Text } from './content-parts'
import { isExpandable } from './row-rules'

interface ItemProps<T> {
  item: T
  lang: Lang
  messages: Messages
}

/**
 * ブログ・コーディング記録の行。左右の余白（inset-dense）は、行を並べる枠（section-pager）が左右に広げた分で、
 * 文字の位置はセクション見出しと揃う。行全体が詳細へのリンクなので、ホバーで地を変える
 */
const postRow = css({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 'inline',
  px: 'inset-dense',
  py: 'inset-dense',
  textStyle: 'body',
  borderRadius: 'control',
  transitionProperty: 'background-color',
  transitionDuration: 'motion.hover',
  transitionTimingFunction: 'motion.hover',
  _hover: { bg: 'bg.subtle' },
})

/** 左右を1行に並べ、モバイルでは右のメタを2行目に回す */
const twoLineOnMobile = css({
  display: 'flex',
  flexDirection: { base: 'column', tablet: 'row' },
  alignItems: { base: 'flex-start', tablet: 'center' },
  gap: 'inline',
  flex: '1',
  minW: '[0]',
})

const metaText = css({ textStyle: 'meta', color: 'text.muted', whiteSpace: 'nowrap' })
const mutedText = css({ color: 'text.muted' })

/** 行全体を押せるようにするリンク（ブログ・コーディング記録）。タイトルのリンクの ::after を行いっぱいに広げる */
const stretchedLink = css({
  color: 'text.default',
  textDecoration: 'none',
  _after: { content: '""', position: 'absolute', inset: 'none' },
})

/**
 * 経歴・作品・プロジェクトの行の頭。▸・名前・右のメタを格子に置く。モバイルの経歴は右のメタ（期間）を2行目に回し、
 * ▸ の左端から始める。▸ の左端・2行目・広げた中（expandedArea）の左端は、どれも行の左の余白（inset-dense）の位置で揃う
 */
const rowHead = cva({
  base: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    gridTemplateAreas: '"toggle main meta"',
    alignItems: 'start',
    columnGap: 'inline',
    w: '[100%]',
    px: 'inset-dense',
    py: 'inset-dense',
    textStyle: 'body',
    textAlign: 'start',
    color: 'text.default',
    borderRadius: 'control',
    // 行を並べる枠（section-pager）が横にはみ出しを切るので、フォーカスの枠は行の内側に描く
    outlineOffset: '-inline-tight',
  },
  variants: {
    metaBelowOnMobile: {
      false: {},
      true: {
        gridTemplateColumns: { base: 'auto minmax(0, 1fr)', tablet: 'auto minmax(0, 1fr) auto' },
        gridTemplateAreas: { base: '"toggle main" "meta meta"', tablet: '"toggle main meta"' },
      },
    },
    interactive: {
      false: {},
      true: {
        cursor: 'pointer',
        transitionProperty: 'background-color',
        transitionDuration: 'motion.hover',
        transitionTimingFunction: 'motion.hover',
        _hover: { bg: 'bg.subtle' },
      },
    },
  },
  defaultVariants: { metaBelowOnMobile: false, interactive: false },
})

/**
 * 本文の1行の高さを持ち、中身をその上下の中央に置く箱。▸ と右のメタをこれに入れ、名前が折り返しても先頭の行に揃える。
 * 高さは中の幅0の文字（ゼロ幅スペース）の行の高さで決まる
 */
const firstLineBox = css({
  display: 'inline-flex',
  alignItems: 'center',
  textStyle: 'body',
  _before: { content: '"\\200B"' },
})

/** 広げた中。左右の余白は行と同じ */
const expandedArea = css({ display: 'flex', flexDirection: 'column', gap: 'inline', px: 'inset-dense', pb: 'inset' })

/** 広げた中の入口のリンク。本文中のリンクと同じく、濃い色と下線（design-spec 4.4） */
const entryLink = css({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'inline-tight',
  textStyle: 'body-sm',
  color: 'link.default',
  textDecoration: 'underline',
  textDecorationColor: 'link.underline',
  _hover: { textDecorationColor: 'link.default' },
})

/**
 * 経歴・作品・プロジェクトの行。広げるものがあれば頭の部分を丸ごと1つのボタンにし、押すと広げる・閉じる。
 * ボタンの読み上げ名は名前（nameId の要素）だけ。広げた中の包み（contentId）は閉じているあいだも残し、
 * aria-controls が無い id を指さないようにする
 */
function DisclosureRow({
  expandable,
  metaBelowOnMobile = false,
  name,
  label,
  meta,
  children,
}: {
  expandable: boolean
  metaBelowOnMobile?: boolean
  /** 行の名前。ボタンの読み上げ名になる */
  name: ReactNode
  label: ReactNode
  /** 右のメタ。広げたときに出さないものは、呼び出し側が expanded を見て外す */
  meta: (expanded: boolean) => ReactNode
  /** 広げた中 */
  children: ReactNode
}) {
  const contentId = useId()
  const nameId = useId()
  const [expanded, setExpanded] = useState(false)
  const Chevron = expanded ? ChevronDownIcon : ChevronRightIcon
  const rowMeta = meta(expanded)
  const content = (
    <>
      <span
        aria-hidden="true"
        className={cx(
          firstLineBox,
          css({ gridArea: 'toggle', color: 'text.muted', visibility: expandable ? 'visible' : 'hidden' }),
        )}
      >
        <Chevron size="sm" />
      </span>
      <RowMain expanded={expanded} label={label}>
        <span id={nameId}>{name}</span>
      </RowMain>
      {rowMeta !== null && <span className={cx(firstLineBox, css({ gridArea: 'meta' }))}>{rowMeta}</span>}
    </>
  )
  if (!expandable) {
    return (
      <article>
        <div className={rowHead({ metaBelowOnMobile })}>{content}</div>
      </article>
    )
  }
  return (
    <article>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        aria-labelledby={nameId}
        onClick={() => setExpanded((value) => !value)}
        className={rowHead({ metaBelowOnMobile, interactive: true })}
      >
        {content}
      </button>
      <div id={contentId}>{expanded && <div className={expandedArea}>{children}</div>}</div>
    </article>
  )
}

/**
 * 行の左。名前と、その後ろの言語ラベル。閉じているあいだは名前がはみ出したら「…」で切り、
 * 広げると切らずに折り返して全文を出す（言語ラベルは名前の続きに置く）
 */
function RowMain({ expanded, children, label }: { expanded: boolean; children: ReactNode; label?: ReactNode }) {
  if (expanded) {
    return (
      <span className={css({ gridArea: 'main', minW: '[0]', overflowWrap: 'anywhere' })}>
        {children} {label}
      </span>
    )
  }
  return (
    <span className={css({ gridArea: 'main', display: 'flex', alignItems: 'center', gap: 'inline', minW: '[0]' })}>
      <span className={css({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minW: '[0]' })}>
        {children}
      </span>
      {label}
    </span>
  )
}

/** ブログ・コーディング記録の行の左。名前（はみ出したら「…」で切る）と、その後ろの言語ラベル */
function PostRowMain({ children, label }: { children: ReactNode; label?: ReactNode }) {
  return (
    <div
      className={css({
        display: 'flex',
        alignItems: 'center',
        gap: 'inline',
        flex: '1',
        alignSelf: 'stretch',
        minW: '[0]',
      })}
    >
      <span className={css({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minW: '[0]' })}>
        {children}
      </span>
      {label}
    </div>
  )
}

/** 行の右のメタ。切らない */
function RowMeta({ children }: { children: ReactNode }) {
  return <div className={css({ display: 'flex', alignItems: 'center', gap: 'inline', flexShrink: 0 })}>{children}</div>
}

/** 「名前 ~ 説明」の「~ 説明」。説明はグレー */
function Tilde({ children }: { children: ReactNode }) {
  return (
    <span className={mutedText}>
      {' ~ '}
      {children}
    </span>
  )
}

export function CareerRow({ item, lang, messages }: ItemProps<CareerItem>) {
  return (
    <DisclosureRow
      expandable={isExpandable({ section: 'careers', item })}
      metaBelowOnMobile
      name={
        item.organization ? (
          <>
            <Text text={item.organization} pageLang={lang} />
            <Tilde>
              <Text text={item.title} pageLang={lang} />
            </Tilde>
          </>
        ) : (
          <Text text={item.title} pageLang={lang} />
        )
      }
      label={<LanguageLabel availability={item.availability} messages={messages} />}
      meta={() => <span className={metaText}>{formatPeriod(lang, item.period.start, item.period.end)}</span>}
    >
      <p className={css({ textStyle: 'body-sm', color: 'text.muted' })}>
        {messages.careerKind[item.kind]}
        {item.location && (
          <>
            {' · '}
            <Text text={item.location} pageLang={lang} />
          </>
        )}
      </p>
      {item.body && (
        <MarkdownBody
          html={item.body.html}
          copyLabels={messages.code}
          lang={item.body.lang === lang ? undefined : item.body.lang}
        />
      )}
    </DisclosureRow>
  )
}

/** 作品・プロジェクトの広げた中に出すもの。サムネイル・概要・使用技術の無いものは、その場所を空けずに詰める */
interface PortfolioDetail {
  title: LocalizedText
  thumbnailUrl: string | null
  summary: LocalizedText | null
  stacks: StackChip[]
}

/** 広げた中の最後の入口のリンク（design-spec 6.1.4）。この順に並べ、無いものは詰める */
interface PortfolioEntries {
  detail: { to: '/$lang/works/$slug' | '/$lang/projects/$slug'; slug: string } | null
  linkUrl: string | null
  githubUrl: string | null
}

function EntryLinks({ entries, lang, messages }: { entries: PortfolioEntries; lang: Lang; messages: Messages }) {
  const external = [
    { href: entries.linkUrl, label: messages.action.visitSite },
    { href: entries.githubUrl, label: messages.action.github },
  ].filter((link): link is { href: string; label: string } => link.href !== null)
  if (entries.detail === null && external.length === 0) return null
  return (
    <div className={css({ display: 'flex', flexWrap: 'wrap', columnGap: 'inset', rowGap: 'inline' })}>
      {entries.detail !== null && (
        <Link to={entries.detail.to} params={{ lang, slug: entries.detail.slug }} className={entryLink}>
          {messages.action.viewDetails}
          <ArrowRightIcon size="sm" />
        </Link>
      )}
      {external.map((link) => (
        <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" className={entryLink}>
          {link.label}
          <ExternalMark messages={messages} />
        </a>
      ))}
    </div>
  )
}

/** 作品・プロジェクトの行。閉じた行は左にタイトルと言語ラベル、右に使用技術。広げると右の使用技術を隠す */
function PortfolioRow({
  detail,
  entries,
  expandable,
  availability,
  lang,
  messages,
  period,
}: {
  detail: PortfolioDetail
  entries: PortfolioEntries
  expandable: boolean
  availability: ProjectItem['availability']
  lang: Lang
  messages: Messages
  /** プロジェクトの期間。広げた中の先頭に出す */
  period?: string
}) {
  const hasMedia = detail.thumbnailUrl !== null || detail.summary !== null || detail.stacks.length > 0
  return (
    <DisclosureRow
      expandable={expandable}
      name={<Text text={detail.title} pageLang={lang} />}
      label={<LanguageLabel availability={availability} messages={messages} />}
      meta={(expanded) =>
        expanded || detail.stacks.length === 0 ? null : (
          <StackIconRow stacks={detail.stacks} max={MAX_ROW_STACKS} inButton messages={messages} />
        )
      }
    >
      {period !== undefined && <p className={metaText}>{period}</p>}
      {hasMedia && (
        <div className={css({ display: 'flex', alignItems: 'flex-start', gap: 'inset' })}>
          {detail.thumbnailUrl !== null && (
            <FallbackImage
              src={detail.thumbnailUrl}
              alt={detail.title.value}
              className={css({ w: 'thumbnail-row', aspectRatio: 'thumbnail', borderRadius: 'image', flexShrink: 0 })}
            />
          )}
          <div className={css({ display: 'flex', flexDirection: 'column', gap: 'inline', flex: '1', minW: '[0]' })}>
            {detail.summary && (
              <Text
                as="p"
                text={detail.summary}
                pageLang={lang}
                className={css({ textStyle: 'body-sm', color: 'text.muted' })}
              />
            )}
            <StackIconRow stacks={detail.stacks} messages={messages} />
          </div>
        </div>
      )}
      <EntryLinks entries={entries} lang={lang} messages={messages} />
    </DisclosureRow>
  )
}

export function ProjectRow({ item, lang, messages }: ItemProps<ProjectItem>) {
  return (
    <PortfolioRow
      detail={item}
      entries={{
        detail: item.hasDetail ? { to: '/$lang/projects/$slug', slug: item.slug } : null,
        linkUrl: item.linkUrl,
        githubUrl: null,
      }}
      expandable={isExpandable({ section: 'projects', item })}
      availability={item.availability}
      lang={lang}
      messages={messages}
      period={formatPeriod(lang, item.period.start, item.period.end)}
    />
  )
}

export function WorkRow({ item, lang, messages }: ItemProps<WorkItem>) {
  return (
    <PortfolioRow
      detail={item}
      entries={{
        detail: item.hasDetail ? { to: '/$lang/works/$slug', slug: item.slug } : null,
        linkUrl: item.linkUrl,
        githubUrl: item.githubUrl,
      }}
      expandable={isExpandable({ section: 'works', item })}
      availability={item.availability}
      lang={lang}
      messages={messages}
    />
  )
}

/** ブログ記事・コーディング記録の行。行全体を押すと P4・P5 へ。モバイルでは公開日と言語ラベルを2行目に回す */
function PostRow({
  item,
  lang,
  messages,
  to,
  kindLabel,
}: ItemProps<BlogPostItem> & { to: '/$lang/blog/$slug' | '/$lang/coding/$slug'; kindLabel?: string }) {
  const label = <LanguageLabel availability={item.availability} messages={messages} />
  return (
    <article className={postRow}>
      <div className={twoLineOnMobile}>
        <PostRowMain label={<span className={css({ hideBelow: 'tablet', display: 'inline-flex' })}>{label}</span>}>
          {kindLabel && (
            <>
              <span className={mutedText}>{kindLabel}</span>{' '}
            </>
          )}
          <Link to={to} params={{ lang, slug: item.slug }} className={stretchedLink}>
            <Text text={item.title} pageLang={lang} />
          </Link>
        </PostRowMain>
        <RowMeta>
          <time dateTime={item.publishedAt} className={metaText}>
            {formatDate(lang, item.publishedAt)}
          </time>
          <span className={css({ hideFrom: 'tablet', display: 'inline-flex' })}>{label}</span>
        </RowMeta>
      </div>
    </article>
  )
}

export function BlogPostRow({ item, lang, messages }: ItemProps<BlogPostItem>) {
  return <PostRow item={item} lang={lang} messages={messages} to="/$lang/blog/$slug" />
}

export function CodingLogRow({ item, lang, messages }: ItemProps<CodingLogItem>) {
  return (
    <PostRow
      item={item}
      lang={lang}
      messages={messages}
      to="/$lang/coding/$slug"
      kindLabel={messages.codingLogKind[item.kind]}
    />
  )
}

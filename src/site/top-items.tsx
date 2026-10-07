/**
 * トップのセクションの1件の表示（design-spec 6.1.4）。どの項目も1行の行で、経歴・作品・プロジェクトは左の ▸ で
 * その場に中身を広げる。行は左に名前（はみ出したら「…」で切る）、右にメタ（切らない）
 */
import { Link } from '@tanstack/react-router'
import { type ReactNode, useId, useState } from 'react'
import { css, cva, cx } from 'styled-system/css'
import type { LocalizedText } from '~/content/localize'
import type { BlogPostItem, CareerItem, CodingLogItem, ProjectItem, StackChip, WorkItem } from '~/content/types'
import type { Lang } from '~/i18n/detect'
import { formatDate, formatPeriod } from '~/i18n/format'
import type { Messages } from '~/i18n/messages'
import { SocialIcon } from '~/ui/brand-icons'
import { ChevronDownIcon, ChevronRightIcon, ExternalLinkIcon } from '~/ui/icons'
import { FallbackImage } from '~/ui/image'
import { MarkdownBody } from '~/ui/markdown-body'
import { LanguageLabel, MAX_ROW_STACKS, StackIconRow, Text } from './content-parts'

interface ItemProps<T> {
  item: T
  lang: Lang
  messages: Messages
}

/**
 * 行。左右の余白（inset-dense）は、行を並べる枠（section-pager）が左右に広げた分で、文字の位置はセクション見出しと揃う。
 * 押せる行はホバーで地を変える。押せない行（経歴、行き先のない作品・プロジェクト）は変えない
 */
const row = cva({
  base: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: 'inline',
    px: 'inset-dense',
    py: 'inset-dense',
    textStyle: 'body',
    borderRadius: 'control',
  },
  variants: {
    interactive: {
      false: {},
      true: {
        transitionProperty: 'background-color',
        transitionDuration: 'motion.hover',
        transitionTimingFunction: 'motion.hover',
        _hover: { bg: 'bg.subtle' },
      },
    },
  },
  defaultVariants: { interactive: false },
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

/**
 * 行全体を押せるようにするリンク。タイトルのリンクの ::after を、位置を持つ一番近い祖先いっぱいに広げる。
 * 後ろに置いた別のリンク（外部リンク・GitHub のアイコン）は、位置を持たせてこの上に重ねる
 */
const stretchedLink = css({
  color: 'text.default',
  textDecoration: 'none',
  _after: { content: '""', position: 'absolute', inset: 'none' },
})

/** 行の右の小さなアイコンのリンク。行のリンクより上に重ねる */
const rowIconLink = css({
  position: 'relative',
  display: 'inline-flex',
  p: 'inline-tight',
  color: 'text.muted',
  borderRadius: 'control',
  _hover: { color: 'text.default' },
})

/**
 * ▸ のボタン。行の左の余白と、名前との間もボタンに含め、行のどこを押しても「広げる」か「行き先へ移る」の
 * どちらかになるようにする（行の左右の余白と隙間は、ボタンと linkArea が持つ）
 */
const toggle = css({
  position: 'relative',
  display: 'inline-flex',
  flexShrink: 0,
  py: 'inline-tight',
  pl: 'inset-dense',
  pr: 'inline',
  color: 'text.muted',
  borderRadius: 'control',
  cursor: 'pointer',
  _hover: { color: 'text.default' },
})
/**
 * 広げるものが無い行の、▸ の代わりの空き。linkArea の中に置いて押せる範囲に含めるので、右は linkArea の gap が受け持つ。
 * 合わせた幅は ▸ のボタンと同じで、名前の位置が揃う
 */
const toggleSpacer = css({
  display: 'inline-flex',
  flexShrink: 0,
  py: 'inline-tight',
  pl: 'inset-dense',
  visibility: 'hidden',
})

/**
 * 作品・プロジェクトの行の、▸ を除いた部分。タイトルのリンクの ::after はここいっぱいに広がる。
 * ▸ は DOM でリンクより前にあり、行いっぱいに広げると ::after の下になって押せないため、範囲をここに限る。
 * 行の上下と右の余白もここに持たせ、▸ のほかはどこを押しても行き先へ移るようにする
 */
const linkArea = css({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 'inline',
  flex: '1',
  minW: '[0]',
  py: 'inset-dense',
  pr: 'inset-dense',
})

/** 広げた中。左右の余白は行と同じ */
const expandedArea = css({ display: 'flex', flexDirection: 'column', gap: 'inline', px: 'inset-dense', pb: 'inset' })

/** 行を広げる・閉じる状態と、▸ のボタン。ボタンの読み上げ名は行の名前（nameId の要素） */
function useExpander() {
  const contentId = useId()
  const nameId = useId()
  const [expanded, setExpanded] = useState(false)
  const Chevron = expanded ? ChevronDownIcon : ChevronRightIcon
  const button = (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={contentId}
      aria-labelledby={nameId}
      onClick={() => setExpanded((value) => !value)}
      className={toggle}
    >
      <Chevron size="sm" />
    </button>
  )
  return { expanded, contentId, nameId, button }
}

function ToggleSpacer() {
  return (
    <span aria-hidden="true" className={toggleSpacer}>
      <ChevronRightIcon size="sm" />
    </span>
  )
}

/**
 * 行の左。名前（はみ出したら「…」で切る）と、その後ろの言語ラベル。
 * モバイルで2行に分ける行でも、幅いっぱいを使って切る
 */
function RowMain({ children, label }: { children: ReactNode; label?: ReactNode }) {
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
function Tilde({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx(mutedText, className)}>
      {' ~ '}
      {children}
    </span>
  )
}

export function CareerRow({ item, lang, messages }: ItemProps<CareerItem>) {
  const { expanded, contentId, nameId, button } = useExpander()
  return (
    <article>
      {/* モバイルでは期間が2行目に回るので、▸ は1行目に揃える。左右の余白と隙間は ▸ と右の要素が持つ */}
      <div
        className={css(row.raw(), {
          px: 'none',
          gap: 'none',
          alignItems: { base: 'flex-start', tablet: 'center' },
        })}
      >
        {button}
        <div className={cx(twoLineOnMobile, css({ pr: 'inset-dense' }))}>
          <RowMain label={<LanguageLabel availability={item.availability} messages={messages} />}>
            <span id={nameId}>
              {item.organization ? (
                <>
                  <Text text={item.organization} pageLang={lang} />
                  <Tilde>
                    <Text text={item.title} pageLang={lang} />
                  </Tilde>
                </>
              ) : (
                <Text text={item.title} pageLang={lang} />
              )}
            </span>
          </RowMain>
          <span className={metaText}>{formatPeriod(lang, item.period.start, item.period.end)}</span>
        </div>
      </div>
      <div id={contentId}>
        {expanded && (
          <div className={expandedArea}>
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
          </div>
        )}
      </div>
    </article>
  )
}

type RowTarget =
  | { kind: 'detail'; to: '/$lang/works/$slug' | '/$lang/projects/$slug'; slug: string }
  | { kind: 'external'; href: string }
  | { kind: 'none' }

/** 行の行き先を持つタイトル。外部へ移るものは「別タブで開く」を読み上げる（見た目の印は行の右に置く） */
function RowTitle({
  title,
  lang,
  messages,
  target,
  nameId,
}: {
  title: LocalizedText
  lang: Lang
  messages: Messages
  target: RowTarget
  /** ▸ の読み上げ名にする、タイトルの文字だけの要素の id */
  nameId: string
}) {
  const text = (
    <span id={nameId}>
      <Text text={title} pageLang={lang} />
    </span>
  )
  if (target.kind === 'detail') {
    return (
      <Link to={target.to} params={{ lang, slug: target.slug }} className={stretchedLink}>
        {text}
      </Link>
    )
  }
  if (target.kind === 'external') {
    return (
      <a href={target.href} target="_blank" rel="noopener noreferrer" className={stretchedLink}>
        {text}
        <span className={css({ srOnly: true })}>{messages.label.opensInNewTab}</span>
      </a>
    )
  }
  return text
}

/** 作品・プロジェクトを広げた中に出すもの。サムネイル・概要・使用技術の無いものは、その場所を空けずに詰める */
interface PortfolioDetail {
  title: LocalizedText
  thumbnailUrl: string | null
  summary: LocalizedText | null
  stacks: StackChip[]
}

function hasDetailToShow(detail: PortfolioDetail): boolean {
  return detail.thumbnailUrl !== null || detail.summary !== null || detail.stacks.length > 0
}

function PortfolioDetailBody({
  detail,
  period,
  lang,
  messages,
}: {
  detail: PortfolioDetail
  period?: string
  lang: Lang
  messages: Messages
}) {
  return (
    <div className={expandedArea}>
      {period !== undefined && <p className={metaText}>{period}</p>}
      {hasDetailToShow(detail) && (
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
            <StackIconRow stacks={detail.stacks} max={MAX_ROW_STACKS.expanded} messages={messages} />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 作品・プロジェクトの行。▸ で広げ、ほかの部分は行き先へ移る。モバイルでは「~ 概要」を出さずに幅を空ける。
 * `period` を渡したもの（プロジェクト）は、広げるものがいつもあるので必ず ▸ を出す
 */
function PortfolioRow({
  detail,
  target,
  availability,
  lang,
  messages,
  meta,
  period,
}: {
  detail: PortfolioDetail
  target: RowTarget
  availability: ProjectItem['availability']
  lang: Lang
  messages: Messages
  meta: ReactNode
  period?: string
}) {
  const { expanded, contentId, nameId, button } = useExpander()
  const expandable = period !== undefined || hasDetailToShow(detail)
  return (
    <article>
      <div className={css(row.raw({ interactive: target.kind !== 'none' }), { py: 'none', px: 'none', gap: 'none' })}>
        {expandable && button}
        <div className={linkArea}>
          {!expandable && <ToggleSpacer />}
          <RowMain label={<LanguageLabel availability={availability} messages={messages} />}>
            <RowTitle title={detail.title} lang={lang} messages={messages} target={target} nameId={nameId} />
            {detail.summary && (
              <Tilde className={css({ hideBelow: 'tablet' })}>
                <Text text={detail.summary} pageLang={lang} />
              </Tilde>
            )}
          </RowMain>
          <RowMeta>
            <StackIconRow stacks={detail.stacks} max={MAX_ROW_STACKS.row} messages={messages} />
            {meta}
          </RowMeta>
        </div>
      </div>
      <div id={expandable ? contentId : undefined}>
        {expandable && expanded && (
          <PortfolioDetailBody detail={detail} period={period} lang={lang} messages={messages} />
        )}
      </div>
    </article>
  )
}

export function ProjectRow({ item, lang, messages }: ItemProps<ProjectItem>) {
  const target: RowTarget = item.hasDetail
    ? { kind: 'detail', to: '/$lang/projects/$slug', slug: item.slug }
    : item.linkUrl !== null
      ? { kind: 'external', href: item.linkUrl }
      : { kind: 'none' }
  return (
    <PortfolioRow
      detail={item}
      target={target}
      availability={item.availability}
      lang={lang}
      messages={messages}
      period={formatPeriod(lang, item.period.start, item.period.end)}
      meta={
        target.kind === 'external' && (
          <span className={css({ display: 'inline-flex', color: 'text.muted' })}>
            <ExternalLinkIcon size="sm" />
          </span>
        )
      }
    />
  )
}

/** 外部リンク・GitHub のアイコン。行の行き先に関わらず、いつでも直接その先を別タブで開く */
function WorkLinks({ item, messages }: { item: WorkItem; messages: Messages }) {
  return (
    <>
      {item.linkUrl !== null && (
        <a
          href={item.linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={messages.action.visitSite}
          title={messages.action.visitSite}
          className={rowIconLink}
        >
          <ExternalLinkIcon size="sm" />
        </a>
      )}
      {item.githubUrl !== null && (
        <a
          href={item.githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={messages.action.github}
          title={messages.action.github}
          className={rowIconLink}
        >
          <SocialIcon service="github" size="sm" />
        </a>
      )}
    </>
  )
}

export function WorkRow({ item, lang, messages }: ItemProps<WorkItem>) {
  const external = item.linkUrl ?? item.githubUrl
  const target: RowTarget = item.hasDetail
    ? { kind: 'detail', to: '/$lang/works/$slug', slug: item.slug }
    : external !== null
      ? { kind: 'external', href: external }
      : { kind: 'none' }
  return (
    <PortfolioRow
      detail={item}
      target={target}
      availability={item.availability}
      lang={lang}
      messages={messages}
      meta={<WorkLinks item={item} messages={messages} />}
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
    <article className={row({ interactive: true })}>
      <div className={twoLineOnMobile}>
        <RowMain label={<span className={css({ hideBelow: 'tablet', display: 'inline-flex' })}>{label}</span>}>
          {kindLabel && (
            <>
              <span className={mutedText}>{kindLabel}</span>{' '}
            </>
          )}
          <Link to={to} params={{ lang, slug: item.slug }} className={stretchedLink}>
            <Text text={item.title} pageLang={lang} />
          </Link>
        </RowMain>
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

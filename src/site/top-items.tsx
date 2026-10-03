/**
 * トップのセクションの1件の表示（design-spec 6.1.4）。経歴の行・プロジェクトと作品のカード・ブログとコーディング記録の行
 */
import { Link } from '@tanstack/react-router'
import { useEffect, useId, useRef, useState } from 'react'
import { css, cx } from 'styled-system/css'
import type { LocalizedText } from '~/content/localize'
import type { BlogPostItem, CareerItem, CodingLogItem, ProjectItem, WorkItem } from '~/content/types'
import type { Lang } from '~/i18n/detect'
import { formatDate, formatPeriod } from '~/i18n/format'
import type { Messages } from '~/i18n/messages'
import { SocialIcon } from '~/ui/brand-icons'
import { ExternalLinkIcon } from '~/ui/icons'
import { FallbackImage } from '~/ui/image'
import { MarkdownBody } from '~/ui/markdown-body'
import { button, card, label } from '~/ui/recipes'
import { ExternalMark, LanguageLabel, StackIconRow, Text } from './content-parts'

interface ItemProps<T> {
  item: T
  lang: Lang
  messages: Messages
}

const metaRow = css({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'inline' })
const metaText = css({ textStyle: 'meta', color: 'text.muted' })
const itemTitle = css({ textStyle: 'heading-3' })
/** 概要・抜粋は2行まで（design-spec 6.1.4） */
const twoLines = css({ lineClamp: 2, textStyle: 'body-sm', color: 'text.muted' })
const thumbnail = css({ w: 'thumbnail-card', aspectRatio: 'thumbnail', borderRadius: 'image', flexShrink: 0 })

/**
 * カード全体を押せるようにするリンク。タイトルのリンクの ::after をカードいっぱいに広げる。
 * カードの中の別のリンク（外部リンク・GitHub のアイコン）は、後ろに置いて位置を持たせ、この上に重ねる
 */
const stretchedLink = css({
  color: 'text.default',
  textDecoration: 'none',
  _hover: { color: 'accent.hover' },
  _after: { content: '""', position: 'absolute', inset: 'none' },
})

const readMoreButton = css(button.raw({ variant: 'ghost' }), {
  alignSelf: 'flex-start',
  px: 'none',
  color: 'accent.default',
})

function Thumbnail({ url, alt }: { url: string | null; alt: string }) {
  // サムネイルがない中身は、画像の場所を空けずに詰める（design-spec 4.4）
  if (url === null) return null
  return <FallbackImage src={url} alt={alt} className={thumbnail} />
}

export function CareerRow({ item, lang, messages }: ItemProps<CareerItem>) {
  const bodyId = useId()
  const bodyRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)

  // 内容が2行を超えるときだけ「続きを読む」を出す。幅が変わると行数も変わるので測り直す
  useEffect(() => {
    const body = bodyRef.current
    if (!body || expanded) return
    const measure = () => setOverflowing(body.scrollHeight > body.clientHeight + 1)
    const observer = new ResizeObserver(measure)
    observer.observe(body)
    measure()
    return () => observer.disconnect()
  }, [expanded])

  const place = (['organization', 'location'] as const).flatMap((field) => {
    const text = item[field]
    return text === null ? [] : [{ field, text }]
  })
  return (
    <article className={css({ display: 'flex', flexDirection: 'column', gap: 'inline', py: 'inset-dense' })}>
      <div className={metaRow}>
        <span className={metaText}>{formatPeriod(lang, item.period.start, item.period.end)}</span>
        <span className={label()}>{messages.careerKind[item.kind]}</span>
        <LanguageLabel availability={item.availability} messages={messages} />
      </div>
      <Text as="h3" text={item.title} pageLang={lang} className={itemTitle} />
      {place.length > 0 && (
        <p className={css({ textStyle: 'body-sm', color: 'text.muted' })}>
          {place.map(({ field, text }, index) => (
            <span key={field}>
              {index > 0 && ' · '}
              <Text text={text} pageLang={lang} />
            </span>
          ))}
        </p>
      )}
      {item.body && (
        <>
          <div
            id={bodyId}
            ref={bodyRef}
            // 2行ぶんの高さで切る。行の高さは本文の書式（MarkdownBody の body）と揃える
            className={cx(css({ textStyle: 'body' }), !expanded && css({ maxH: '[2lh]', overflow: 'hidden' }))}
          >
            <MarkdownBody
              html={item.body.html}
              copyLabels={messages.code}
              lang={item.body.lang === lang ? undefined : item.body.lang}
            />
          </div>
          {(overflowing || expanded) && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={bodyId}
              onClick={() => setExpanded((value) => !value)}
              className={readMoreButton}
            >
              {expanded ? messages.action.close : messages.action.readMore}
            </button>
          )}
        </>
      )}
    </article>
  )
}

interface CardTarget {
  kind: 'detail' | 'external' | 'none'
  /** 詳細ページのルート、または外部の URL */
  href?: string
}

/** カードの行き先と、そのタイトル。外部へ移るものに「別タブで開く」の印を付ける（design-spec 6.1.4） */
function CardTitle({
  title,
  lang,
  messages,
  target,
  detail,
}: {
  title: LocalizedText
  lang: Lang
  messages: Messages
  target: CardTarget
  detail?: { to: '/$lang/works/$slug' | '/$lang/projects/$slug'; slug: string }
}) {
  const text = <Text text={title} pageLang={lang} />
  return (
    <h3 className={itemTitle}>
      {target.kind === 'detail' && detail ? (
        <Link to={detail.to} params={{ lang, slug: detail.slug }} className={stretchedLink}>
          {text}
        </Link>
      ) : target.kind === 'external' ? (
        <a
          href={target.href}
          target="_blank"
          rel="noopener noreferrer"
          className={cx(stretchedLink, css({ display: 'inline-flex', alignItems: 'center', gap: 'inline' }))}
        >
          {text}
          <ExternalMark messages={messages} />
        </a>
      ) : (
        text
      )}
    </h3>
  )
}

/** 同じプロパティを上書きするので、cx でクラスを並べず、card のスタイルに重ねて1つの css にする */
const cardLayout = (interactive: boolean) =>
  css(card.raw({ interactive }), { position: 'relative', flexDirection: 'row', alignItems: 'flex-start', gap: 'inset' })
// minW は、横に並べた中で長い語・2行の切り詰めが本文の幅に収まるよう、中身の幅より縮められるようにする
const cardBody = css({ display: 'flex', flexDirection: 'column', gap: 'inline', minW: '[0]', flex: '1' })

export function ProjectCard({ item, lang, messages }: ItemProps<ProjectItem>) {
  const target: CardTarget = item.hasDetail
    ? { kind: 'detail' }
    : item.linkUrl !== null
      ? { kind: 'external', href: item.linkUrl }
      : { kind: 'none' }
  return (
    <article className={cardLayout(target.kind !== 'none')}>
      <Thumbnail url={item.thumbnailUrl} alt={item.title.value} />
      <div className={cardBody}>
        <CardTitle
          title={item.title}
          lang={lang}
          messages={messages}
          target={target}
          detail={{ to: '/$lang/projects/$slug', slug: item.slug }}
        />
        <div className={metaRow}>
          <span className={metaText}>{formatPeriod(lang, item.period.start, item.period.end)}</span>
          <LanguageLabel availability={item.availability} messages={messages} />
        </div>
        {item.summary && <Text as="p" text={item.summary} pageLang={lang} className={twoLines} />}
        <StackIconRow stacks={item.stacks} messages={messages} />
      </div>
    </article>
  )
}

const iconLink = cx(button({ variant: 'ghost', shape: 'icon' }), css({ position: 'relative' }))

export function WorkCard({ item, lang, messages }: ItemProps<WorkItem>) {
  const externalHref = item.linkUrl ?? item.githubUrl
  const target: CardTarget = item.hasDetail
    ? { kind: 'detail' }
    : externalHref !== null
      ? { kind: 'external', href: externalHref }
      : { kind: 'none' }
  return (
    <article className={cardLayout(target.kind !== 'none')}>
      <Thumbnail url={item.thumbnailUrl} alt={item.title.value} />
      <div className={cardBody}>
        <CardTitle
          title={item.title}
          lang={lang}
          messages={messages}
          target={target}
          detail={{ to: '/$lang/works/$slug', slug: item.slug }}
        />
        <div className={metaRow}>
          <LanguageLabel availability={item.availability} messages={messages} />
        </div>
        {item.summary && <Text as="p" text={item.summary} pageLang={lang} className={twoLines} />}
        <div className={cx(metaRow, css({ justifyContent: 'space-between' }))}>
          <StackIconRow stacks={item.stacks} messages={messages} />
          {(item.linkUrl !== null || item.githubUrl !== null) && (
            // 外部リンク・GitHub のアイコンは、カード本体の行き先に関わらず、いつでも直接その先を別タブで開く
            <div className={css({ display: 'flex', gap: 'inline', ml: 'auto' })}>
              {item.linkUrl !== null && (
                <a
                  href={item.linkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={messages.action.visitSite}
                  title={messages.action.visitSite}
                  className={iconLink}
                >
                  <ExternalLinkIcon />
                </a>
              )}
              {item.githubUrl !== null && (
                <a
                  href={item.githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={messages.action.github}
                  title={messages.action.github}
                  className={iconLink}
                >
                  <SocialIcon service="github" />
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

/** ブログ記事・コーディング記録の行。行全体を押すと P4・P5 へ */
function PostRow({
  item,
  lang,
  messages,
  to,
  kindLabel,
}: ItemProps<BlogPostItem> & { to: '/$lang/blog/$slug' | '/$lang/coding/$slug'; kindLabel?: string }) {
  return (
    <article className={cardLayout(true)}>
      <div className={cardBody}>
        <div className={metaRow}>
          <time dateTime={item.publishedAt} className={metaText}>
            {formatDate(lang, item.publishedAt)}
          </time>
          {kindLabel && <span className={label()}>{kindLabel}</span>}
          <LanguageLabel availability={item.availability} messages={messages} />
        </div>
        <h3 className={itemTitle}>
          <Link to={to} params={{ lang, slug: item.slug }} className={stretchedLink}>
            <Text text={item.title} pageLang={lang} />
          </Link>
        </h3>
        {item.excerpt && <Text as="p" text={item.excerpt} pageLang={lang} className={twoLines} />}
      </div>
      <Thumbnail url={item.thumbnailUrl} alt={item.title.value} />
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

/**
 * P4 ブログ記事・P5 コーディング記録詳細の中身（SDD 5.11 の getBlogPost・getCodingLog、design-spec 6.3）。
 * スラッグが存在しない・非公開のときは notFound()（C1）
 */
import { notFound } from '@tanstack/react-router'
import { and, asc, desc, eq } from 'drizzle-orm'
import { blogPost, codingLog } from '~/db/schema'
import { excerptOf } from '~/domain/excerpt'
import type { Lang } from '~/i18n/detect'
import { getMessages } from '~/i18n/messages'
import { availabilityOf, pickText } from './localize'
import { renderLocalizedMarkdown } from './markdown'
import { pageMeta, titleWithSiteName } from './meta'
import type { DetailInput } from './portfolio-detail'
import { published } from './published'
import { bodyPresence, type ContentContext, required } from './shared'
import type { BlogPostView, CodingLogView, Neighbor } from './types'

interface NeighborRow {
  id: string
  slug: string | null
  titleJa: string | null
  titleEn: string | null
  bodyJa: string | null
  bodyEn: string | null
}

/** 公開日の新しい順に並んだ公開中の中から、1つ新しいもの・1つ古いものを出す */
function neighborsOf(rows: NeighborRow[], id: string, lang: Lang): { newer: Neighbor; older: Neighbor } {
  const index = rows.findIndex((row) => row.id === id)
  const toNeighbor = (row: NeighborRow | undefined): Neighbor => {
    if (!row) return null
    const { lang: primary } = availabilityOf('titleAndBody', lang, {
      ja: { title: row.titleJa, body: row.bodyJa },
      en: { title: row.titleEn, body: row.bodyEn },
    })
    return {
      slug: required(row.slug, 'slug'),
      title: required(pickText(primary, { ja: row.titleJa, en: row.titleEn }), 'title'),
    }
  }
  return { newer: toNeighbor(rows[index - 1]), older: toNeighbor(rows[index + 1]) }
}

interface PostRow {
  id: string
  slug: string | null
  titleJa: string | null
  titleEn: string | null
  bodyJa: string | null
  bodyEn: string | null
  thumbnailUrl: string | null
  publishedAt: Date | null
  contentUpdatedAt: Date | null
  updatedAt: Date
}

type CommonPostView = Omit<BlogPostView, 'newer' | 'older'>

async function commonPost(
  { siteUrl }: ContentContext,
  { lang, slug }: DetailInput,
  kind: 'blog-post' | 'coding-log',
  row: PostRow,
): Promise<CommonPostView> {
  const availability = availabilityOf('titleAndBody', lang, {
    ja: { title: row.titleJa, body: row.bodyJa },
    en: { title: row.titleEn, body: row.bodyEn },
  })
  const primary = availability.lang
  const bodies = { ja: row.bodyJa, en: row.bodyEn }
  // 公開のルールで、公開中の記事はどちらかの言語にタイトルと本文の両方を持つ（SDD 5.11）
  const body = required(
    await renderLocalizedMarkdown({ kind, id: row.id, updatedAt: row.updatedAt }, primary, bodies, siteUrl),
    `${kind}.body`,
  )
  const title = required(pickText(primary, { ja: row.titleJa, en: row.titleEn }), `${kind}.title`)
  const bodyText = pickText(primary, bodies)
  const publishedAt = required(row.publishedAt, `${kind}.published_at`)
  // 更新日は、公開日より後のときだけ出す（design-spec 6.3）
  const contentUpdatedAt =
    row.contentUpdatedAt !== null && row.contentUpdatedAt.getTime() > publishedAt.getTime()
      ? row.contentUpdatedAt.toISOString()
      : null
  return {
    lang,
    meta: pageMeta({
      siteUrl,
      lang,
      path: `/${kind === 'blog-post' ? 'blog' : 'coding'}/${slug}`,
      title: titleWithSiteName(title.value, getMessages(lang).siteName),
      description: bodyText ? excerptOf(bodyText.value, bodyText.lang) : null,
      imagePath: row.thumbnailUrl,
    }),
    id: row.id,
    slug,
    title,
    body,
    availability,
    publishedAt: publishedAt.toISOString(),
    contentUpdatedAt,
    thumbnailUrl: row.thumbnailUrl,
  }
}

export async function loadBlogPost(context: ContentContext, input: DetailInput): Promise<BlogPostView> {
  const { db } = context
  const [rows, ordered] = await db.batch([
    db
      .select({
        id: blogPost.id,
        slug: blogPost.slug,
        titleJa: blogPost.titleJa,
        titleEn: blogPost.titleEn,
        bodyJa: blogPost.bodyJa,
        bodyEn: blogPost.bodyEn,
        thumbnailUrl: blogPost.thumbnailUrl,
        publishedAt: blogPost.publishedAt,
        contentUpdatedAt: blogPost.contentUpdatedAt,
        updatedAt: blogPost.updatedAt,
      })
      .from(blogPost)
      .where(and(eq(blogPost.slug, input.slug), published(blogPost)))
      .limit(1),
    // 前後のナビの言語の判定に本文の有無が要る。本文の全文は読まない（空かどうかだけを見る）
    db
      .select({
        id: blogPost.id,
        slug: blogPost.slug,
        titleJa: blogPost.titleJa,
        titleEn: blogPost.titleEn,
        bodyJa: bodyPresence(blogPost.bodyJa),
        bodyEn: bodyPresence(blogPost.bodyEn),
      })
      .from(blogPost)
      .where(published(blogPost))
      .orderBy(desc(blogPost.publishedAt), asc(blogPost.id)),
  ])
  const row = rows[0]
  if (!row) throw notFound()
  const common = await commonPost(context, input, 'blog-post', row)
  return { ...common, ...neighborsOf(ordered, row.id, input.lang) }
}

export async function loadCodingLog(context: ContentContext, input: DetailInput): Promise<CodingLogView> {
  const { db } = context
  const [rows, ordered] = await db.batch([
    db
      .select({
        id: codingLog.id,
        slug: codingLog.slug,
        kind: codingLog.kind,
        titleJa: codingLog.titleJa,
        titleEn: codingLog.titleEn,
        bodyJa: codingLog.bodyJa,
        bodyEn: codingLog.bodyEn,
        referenceUrl: codingLog.referenceUrl,
        thumbnailUrl: codingLog.thumbnailUrl,
        publishedAt: codingLog.publishedAt,
        contentUpdatedAt: codingLog.contentUpdatedAt,
        updatedAt: codingLog.updatedAt,
      })
      .from(codingLog)
      .where(and(eq(codingLog.slug, input.slug), published(codingLog)))
      .limit(1),
    db
      .select({
        id: codingLog.id,
        slug: codingLog.slug,
        titleJa: codingLog.titleJa,
        titleEn: codingLog.titleEn,
        bodyJa: bodyPresence(codingLog.bodyJa),
        bodyEn: bodyPresence(codingLog.bodyEn),
      })
      .from(codingLog)
      .where(published(codingLog))
      .orderBy(desc(codingLog.publishedAt), asc(codingLog.id)),
  ])
  const row = rows[0]
  if (!row) throw notFound()
  const common = await commonPost(context, input, 'coding-log', row)
  return {
    ...common,
    kind: row.kind,
    referenceUrl: row.referenceUrl,
    ...neighborsOf(ordered, row.id, input.lang),
  }
}

import { desc, eq, sql } from 'drizzle-orm'
import { blogPost } from '../../db/schema'
import { languagesOf } from '../../domain/languages'
import { missingForPublish, postDatesAfterSave, type Status, transitionOf } from '../../domain/publishing'
import { inputValidationFailed, publishRequirementsNotMet, slugConflict } from '../errors'
import { admin, db, isUniqueViolation, logOperation, logTransition, toIso, toIsoOrNull } from './base'
import { availableSlug, slugConflictSuggestion } from './slugs'

type BlogPostRow = typeof blogPost.$inferSelect

interface BlogPostInput {
  status: Status
  slug: string | null
  ja: { title: string | null; body: string | null }
  en: { title: string | null; body: string | null }
  thumbnailUrl: string | null
  publishedAt: string | null
}

function localizedOf(row: BlogPostRow) {
  return { ja: { title: row.titleJa, body: row.bodyJa }, en: { title: row.titleEn, body: row.bodyEn } }
}

function toOutput(row: BlogPostRow) {
  const { ja, en } = localizedOf(row)
  return {
    id: row.id,
    status: row.status,
    slug: row.slug,
    ja,
    en,
    thumbnailUrl: row.thumbnailUrl,
    publishedAt: toIsoOrNull(row.publishedAt),
    contentUpdatedAt: toIsoOrNull(row.contentUpdatedAt),
    languages: languagesOf('titleAndBody', ja, en),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  }
}

function toListItem(row: BlogPostRow) {
  const { ja, en } = localizedOf(row)
  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    ja: { title: ja.title },
    en: { title: en.title },
    languages: languagesOf('titleAndBody', ja, en),
    publishedAt: toIsoOrNull(row.publishedAt),
    updatedAt: toIso(row.updatedAt),
  }
}

/**
 * 保存する値を決める。入力の誤り（公開日）→ 公開のルール → スラッグの重複 の順に確かめる。
 * `current` は保存前の行（新規作成は null）
 */
async function prepareSave(input: BlogPostInput, current: BlogPostRow | null) {
  const dates = postDatesAfterSave({
    current: current && {
      status: current.status,
      publishedAt: current.publishedAt,
      contentUpdatedAt: current.contentUpdatedAt,
      ...localizedOf(current),
    },
    next: {
      status: input.status,
      publishedAt: input.publishedAt === null ? null : new Date(input.publishedAt),
      ja: input.ja,
      en: input.en,
    },
    now: new Date(),
  })
  if (!dates.ok) throw inputValidationFailed({ fieldErrors: { publishedAt: [dates.message] }, formErrors: [] })
  if (input.status === 'published') {
    const missing = missingForPublish('blogPost', input)
    if (missing.length > 0) throw publishRequirementsNotMet(missing)
  }
  const suggestion = await slugConflictSuggestion('blog-post', input.slug, current?.id)
  if (suggestion !== null) throw slugConflict(suggestion)
  return {
    status: input.status,
    slug: input.slug,
    titleJa: input.ja.title,
    titleEn: input.en.title,
    bodyJa: input.ja.body,
    bodyEn: input.en.body,
    thumbnailUrl: input.thumbnailUrl,
    publishedAt: dates.publishedAt,
    contentUpdatedAt: dates.contentUpdatedAt,
  }
}

/** 一意インデックスの違反（確かめてから書くまでのあいだの競合）を SLUG_CONFLICT にする（ADR-006） */
async function rethrowSlugConflict(error: unknown, slug: string | null, excludeId?: string): Promise<never> {
  if (slug !== null && isUniqueViolation(error, 'blog_post.slug')) {
    throw slugConflict(await availableSlug('blog-post', slug, excludeId))
  }
  throw error
}

export const blogPosts = {
  list: admin.blogPosts.list.handler(async ({ input }) => {
    const rows = await db()
      .select()
      .from(blogPost)
      .where(input.status ? eq(blogPost.status, input.status) : undefined)
      // 下書きを最終保存日の新しい順で先頭に、続けて公開中を公開日の新しい順（design-spec 6.6）
      .orderBy(
        sql`${blogPost.status} = 'draft' desc`,
        sql`case when ${blogPost.status} = 'draft' then ${blogPost.updatedAt} end desc`,
        desc(blogPost.publishedAt),
        desc(blogPost.createdAt),
      )
    return { items: rows.map(toListItem) }
  }),

  create: admin.blogPosts.create.handler(async ({ input, context }) => {
    const values = await prepareSave(input, null)
    let row: BlogPostRow | undefined
    try {
      ;[row] = await db().insert(blogPost).values(values).returning()
    } catch (e) {
      await rethrowSlugConflict(e, input.slug)
    }
    if (!row) throw new Error('ブログ記事の作成で行が返らない')
    logTransition(context, transitionOf(null, input.status), row.id)
    return toOutput(row)
  }),

  get: admin.blogPosts.get.handler(async ({ input, errors }) => {
    const row = await db().select().from(blogPost).where(eq(blogPost.id, input.params.id)).get()
    if (!row) throw errors.NOT_FOUND()
    return toOutput(row)
  }),

  update: admin.blogPosts.update.handler(async ({ input: { params, body: input }, errors, context }) => {
    const d = db()
    const current = await d.select().from(blogPost).where(eq(blogPost.id, params.id)).get()
    if (!current) throw errors.NOT_FOUND()
    const values = await prepareSave(input, current)
    let row: BlogPostRow | undefined
    try {
      ;[row] = await d.update(blogPost).set(values).where(eq(blogPost.id, params.id)).returning()
    } catch (e) {
      await rethrowSlugConflict(e, input.slug, params.id)
    }
    if (!row) throw errors.NOT_FOUND()
    logTransition(context, transitionOf(current.status, input.status), row.id)
    return toOutput(row)
  }),

  remove: admin.blogPosts.remove.handler(async ({ input, errors, context }) => {
    const [row] = await db().delete(blogPost).where(eq(blogPost.id, input.params.id)).returning({ id: blogPost.id })
    if (!row) throw errors.NOT_FOUND()
    logOperation(context, 'deleted', { id: row.id })
  }),
}

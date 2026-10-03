import { and, eq, isNotNull, ne } from 'drizzle-orm'
import { blogPost, codingLog, project, work } from '../../db/schema'
import { firstAvailable, slugify } from '../../domain/slug'
import type { SLUG_TYPES } from '../contract/misc'
import { admin, db } from './base'

export type SlugType = (typeof SLUG_TYPES)[number]

const TABLES = { work, project, 'blog-post': blogPost, 'coding-log': codingLog } as const

/**
 * 同じ種類の中で、`base` から重複しないスラッグを決める（`base`、`base-2`、`base-3` …）。
 * `excludeId` は編集中の項目で、自分自身のスラッグとは重複とみなさない。
 */
export async function availableSlug(type: SlugType, base: string, excludeId?: string): Promise<string> {
  const table = TABLES[type]
  // 長い base は連番の分だけ削られて前方一致しなくなるので、絞り込まずに同じ種類のスラッグをすべて読む
  // （個人サイトで件数が少ない。design-spec 6.6）
  const rows = await db()
    .select({ slug: table.slug })
    .from(table)
    .where(and(isNotNull(table.slug), excludeId === undefined ? undefined : ne(table.id, excludeId)))
  const taken = new Set(rows.map((row) => row.slug))
  return firstAvailable(base, (candidate) => taken.has(candidate))
}

/** スラッグが同じ種類の中で使われていれば、次に使える値を返す。使われていなければ null */
export async function slugConflictSuggestion(
  type: SlugType,
  slug: string | null,
  excludeId?: string,
): Promise<string | null> {
  if (slug === null) return null
  const suggestion = await availableSlug(type, slug, excludeId)
  return suggestion === slug ? null : suggestion
}

async function isSlugAvailable(type: SlugType, slug: string, excludeId?: string): Promise<boolean> {
  const table = TABLES[type]
  const row = await db()
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.slug, slug), excludeId === undefined ? undefined : ne(table.id, excludeId)))
    .get()
  return row === undefined
}

export const slugs = {
  suggest: admin.slugs.suggest.handler(async ({ input }) => {
    const base = slugify(input.title)
    return { slug: base === null ? null : await availableSlug(input.type, base, input.excludeId) }
  }),

  availability: admin.slugs.availability.handler(async ({ input }) => ({
    available: await isSlugAvailable(input.type, input.slug, input.excludeId),
  })),
}

import { asc, eq, sql } from 'drizzle-orm'
import { work, workStack } from '../../db/schema'
import { hasDetailPage } from '../../domain/detail'
import { languagesOf } from '../../domain/languages'
import { firstPublishedAtAfterSave, missingForPublish, type Status, transitionOf } from '../../domain/publishing'
import { publishRequirementsNotMet, slugConflict } from '../errors'
import {
  admin,
  db,
  isForeignKeyViolation,
  isUniqueViolation,
  logOperation,
  logTransition,
  toIso,
  toIsoOrNull,
} from './base'
import { assertStacksExist, readLinkedStacks, stacksMissing } from './portfolio-shared'
import { availableSlug, slugConflictSuggestion } from './slugs'

type WorkRow = typeof work.$inferSelect

interface WorkInput {
  status: Status
  slug: string | null
  ja: { title: string | null; summary: string | null; body: string | null }
  en: { title: string | null; summary: string | null; body: string | null }
  linkUrl: string | null
  githubUrl: string | null
  thumbnailUrl: string | null
  stackIds: string[]
}

function toValues(input: WorkInput) {
  return {
    status: input.status,
    slug: input.slug,
    titleJa: input.ja.title,
    titleEn: input.en.title,
    summaryJa: input.ja.summary,
    summaryEn: input.en.summary,
    bodyJa: input.ja.body,
    bodyEn: input.en.body,
    linkUrl: input.linkUrl,
    githubUrl: input.githubUrl,
    thumbnailUrl: input.thumbnailUrl,
  }
}

async function readWork(id: string) {
  const row = await db().select().from(work).where(eq(work.id, id)).get()
  if (!row) return null
  const stacks = await readLinkedStacks('work', id)
  const ja = { title: row.titleJa, summary: row.summaryJa, body: row.bodyJa }
  const en = { title: row.titleEn, summary: row.summaryEn, body: row.bodyEn }
  return {
    id: row.id,
    status: row.status,
    slug: row.slug,
    ja,
    en,
    linkUrl: row.linkUrl,
    githubUrl: row.githubUrl,
    thumbnailUrl: row.thumbnailUrl,
    stacks,
    sortOrder: row.sortOrder,
    firstPublishedAt: toIsoOrNull(row.firstPublishedAt),
    hasDetail: hasDetailPage(row.bodyJa, row.bodyEn),
    languages: languagesOf('title', ja, en),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  }
}

function toListItem(row: WorkRow) {
  const ja = { title: row.titleJa }
  const en = { title: row.titleEn }
  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    ja,
    en,
    hasDetail: hasDetailPage(row.bodyJa, row.bodyEn),
    languages: languagesOf('title', ja, en),
    sortOrder: row.sortOrder,
    updatedAt: toIso(row.updatedAt),
  }
}

/** 保存の前の確かめ（公開のルール・使用技術の存在・スラッグの重複） */
async function validateSave(input: WorkInput, excludeId?: string) {
  if (input.status === 'published') {
    const missing = missingForPublish('work', input)
    if (missing.length > 0) throw publishRequirementsNotMet(missing)
  }
  await assertStacksExist(input.stackIds)
  const suggestion = await slugConflictSuggestion('work', input.slug, excludeId)
  if (suggestion !== null) throw slugConflict(suggestion)
}

function stackLinkInserts(workId: string, stackIds: readonly string[]) {
  const d = db()
  // 1つの文のパラメーターは100個までなので、1行ずつ入れる（ADR-006）
  return stackIds.map((stackId, i) => d.insert(workStack).values({ workId, stackId, sortOrder: i }))
}

/** 一意インデックスの違反（確かめてから書くまでのあいだの競合）を SLUG_CONFLICT にする（ADR-006） */
async function rethrowSlugConflict(error: unknown, slug: string | null, excludeId?: string): Promise<never> {
  if (slug !== null && isUniqueViolation(error, 'work.slug')) {
    throw slugConflict(await availableSlug('work', slug, excludeId))
  }
  throw error
}

export const works = {
  list: admin.works.list.handler(async ({ input }) => {
    const rows = await db()
      .select()
      .from(work)
      .where(input.status ? eq(work.status, input.status) : undefined)
      .orderBy(asc(work.sortOrder), asc(work.createdAt))
    return { items: rows.map(toListItem) }
  }),

  create: admin.works.create.handler(async ({ input, context }) => {
    await validateSave(input)
    const d = db()
    const id = crypto.randomUUID()
    const now = new Date()
    try {
      // 新規作成は先頭に入れる（今の最小値 − 1。SDD 6.1）。最小値は同じ文の中で読み、確かめてから書くあいだを作らない
      await d.batch([
        d.insert(work).values({
          ...toValues(input),
          id,
          sortOrder: sql`(select coalesce(min(${work.sortOrder}), 1) - 1 from ${work})`,
          firstPublishedAt: firstPublishedAtAfterSave(null, input.status, now),
        }),
        ...stackLinkInserts(id, input.stackIds),
      ])
    } catch (e) {
      // 確かめてから書くまでのあいだに使用技術が消えた（ADR-006）
      if (isForeignKeyViolation(e)) throw stacksMissing()
      await rethrowSlugConflict(e, input.slug)
    }
    logTransition(context, transitionOf(null, input.status), id)
    const result = await readWork(id)
    if (!result) throw new Error('作品の作成の直後に行が読めない')
    return result
  }),

  get: admin.works.get.handler(async ({ input, errors }) => {
    const result = await readWork(input.params.id)
    if (!result) throw errors.NOT_FOUND()
    return result
  }),

  update: admin.works.update.handler(async ({ input: { params, body: input }, errors, context }) => {
    const d = db()
    const current = await d
      .select({ status: work.status, firstPublishedAt: work.firstPublishedAt })
      .from(work)
      .where(eq(work.id, params.id))
      .get()
    if (!current) throw errors.NOT_FOUND()
    await validateSave(input, params.id)
    try {
      // 作品の更新と work_stack の置き換えは、1回の batch でまとめて確定する（ADR-006）
      await d.batch([
        d
          .update(work)
          .set({
            ...toValues(input),
            firstPublishedAt: firstPublishedAtAfterSave(current.firstPublishedAt, input.status, new Date()),
          })
          .where(eq(work.id, params.id)),
        d.delete(workStack).where(eq(workStack.workId, params.id)),
        ...stackLinkInserts(params.id, input.stackIds),
      ])
    } catch (e) {
      // 確かめてから書くまでのあいだに作品か使用技術が消えた（ADR-006）
      if (isForeignKeyViolation(e)) {
        if (!(await readWork(params.id))) throw errors.NOT_FOUND()
        throw stacksMissing()
      }
      await rethrowSlugConflict(e, input.slug, params.id)
    }
    logTransition(context, transitionOf(current.status, input.status), params.id)
    const result = await readWork(params.id)
    if (!result) throw errors.NOT_FOUND()
    return result
  }),

  remove: admin.works.remove.handler(async ({ input, errors, context }) => {
    // work_stack の紐づけは ON DELETE CASCADE で消える
    const [row] = await db().delete(work).where(eq(work.id, input.params.id)).returning({ id: work.id })
    if (!row) throw errors.NOT_FOUND()
    logOperation(context, 'deleted', { id: row.id })
  }),

  reorder: admin.works.reorder.handler(async ({ input, errors }) => {
    const d = db()
    const rows = await d.select({ id: work.id }).from(work)
    const current = new Set(rows.map((row) => row.id))
    if (rows.length !== input.ids.length || !input.ids.every((id) => current.has(id))) {
      throw errors.ORDER_OUT_OF_DATE()
    }
    const [first, ...rest] = input.ids.map((id, i) =>
      // updated_at に今の値をそのまま入れて、$onUpdateFn で変わらないようにする（SDD 6.1）
      d
        .update(work)
        .set({ sortOrder: i, updatedAt: sql`${work.updatedAt}` })
        .where(eq(work.id, id)),
    )
    if (first) await d.batch([first, ...rest])
    return { ids: input.ids }
  }),
}

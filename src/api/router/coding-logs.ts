import { and, desc, eq, sql } from 'drizzle-orm'
import { type CODING_LOG_KINDS, codingLog } from '../../db/schema'
import { languagesOf } from '../../domain/languages'
import { missingForPublish, postDatesAfterSave, type Status, transitionOf } from '../../domain/publishing'
import { inputValidationFailed, publishRequirementsNotMet, slugConflict } from '../errors'
import { admin, db, isUniqueViolation, logOperation, logTransition, toIso, toIsoOrNull } from './base'
import { availableSlug, slugConflictSuggestion } from './slugs'

type CodingLogRow = typeof codingLog.$inferSelect

interface CodingLogInput {
  status: Status
  slug: string | null
  ja: { title: string | null; body: string | null }
  en: { title: string | null; body: string | null }
  thumbnailUrl: string | null
  publishedAt: string | null
  kind: (typeof CODING_LOG_KINDS)[number]
  referenceUrl: string | null
}

function localizedOf(row: CodingLogRow) {
  return { ja: { title: row.titleJa, body: row.bodyJa }, en: { title: row.titleEn, body: row.bodyEn } }
}

function toOutput(row: CodingLogRow) {
  const { ja, en } = localizedOf(row)
  return {
    id: row.id,
    status: row.status,
    slug: row.slug,
    ja,
    en,
    kind: row.kind,
    referenceUrl: row.referenceUrl,
    thumbnailUrl: row.thumbnailUrl,
    publishedAt: toIsoOrNull(row.publishedAt),
    contentUpdatedAt: toIsoOrNull(row.contentUpdatedAt),
    languages: languagesOf('titleAndBody', ja, en),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  }
}

function toListItem(row: CodingLogRow) {
  const { ja, en } = localizedOf(row)
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
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
async function prepareSave(input: CodingLogInput, current: CodingLogRow | null) {
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
    const missing = missingForPublish('codingLog', input)
    if (missing.length > 0) throw publishRequirementsNotMet(missing)
  }
  const suggestion = await slugConflictSuggestion('coding-log', input.slug, current?.id)
  if (suggestion !== null) throw slugConflict(suggestion)
  return {
    status: input.status,
    slug: input.slug,
    titleJa: input.ja.title,
    titleEn: input.en.title,
    bodyJa: input.ja.body,
    bodyEn: input.en.body,
    kind: input.kind,
    referenceUrl: input.referenceUrl,
    thumbnailUrl: input.thumbnailUrl,
    publishedAt: dates.publishedAt,
    contentUpdatedAt: dates.contentUpdatedAt,
  }
}

/** 一意インデックスの違反（確かめてから書くまでのあいだの競合）を SLUG_CONFLICT にする（ADR-006） */
async function rethrowSlugConflict(error: unknown, slug: string | null, excludeId?: string): Promise<never> {
  if (slug !== null && isUniqueViolation(error, 'coding_log.slug')) {
    throw slugConflict(await availableSlug('coding-log', slug, excludeId))
  }
  throw error
}

export const codingLogs = {
  list: admin.codingLogs.list.handler(async ({ input }) => {
    const rows = await db()
      .select()
      .from(codingLog)
      .where(
        and(
          input.status ? eq(codingLog.status, input.status) : undefined,
          input.kind ? eq(codingLog.kind, input.kind) : undefined,
        ),
      )
      // 下書きを最終保存日の新しい順で先頭に、続けて公開中を公開日の新しい順（design-spec 6.6）
      .orderBy(
        sql`${codingLog.status} = 'draft' desc`,
        sql`case when ${codingLog.status} = 'draft' then ${codingLog.updatedAt} end desc`,
        desc(codingLog.publishedAt),
        desc(codingLog.createdAt),
      )
    return { items: rows.map(toListItem) }
  }),

  create: admin.codingLogs.create.handler(async ({ input, context }) => {
    const values = await prepareSave(input, null)
    let row: CodingLogRow | undefined
    try {
      ;[row] = await db().insert(codingLog).values(values).returning()
    } catch (e) {
      await rethrowSlugConflict(e, input.slug)
    }
    if (!row) throw new Error('コーディング記録の作成で行が返らない')
    logTransition(context, transitionOf(null, input.status), row.id)
    return toOutput(row)
  }),

  get: admin.codingLogs.get.handler(async ({ input, errors }) => {
    const row = await db().select().from(codingLog).where(eq(codingLog.id, input.params.id)).get()
    if (!row) throw errors.NOT_FOUND()
    return toOutput(row)
  }),

  update: admin.codingLogs.update.handler(async ({ input: { params, body: input }, errors, context }) => {
    const d = db()
    const current = await d.select().from(codingLog).where(eq(codingLog.id, params.id)).get()
    if (!current) throw errors.NOT_FOUND()
    const values = await prepareSave(input, current)
    let row: CodingLogRow | undefined
    try {
      ;[row] = await d.update(codingLog).set(values).where(eq(codingLog.id, params.id)).returning()
    } catch (e) {
      await rethrowSlugConflict(e, input.slug, params.id)
    }
    if (!row) throw errors.NOT_FOUND()
    logTransition(context, transitionOf(current.status, input.status), row.id)
    return toOutput(row)
  }),

  remove: admin.codingLogs.remove.handler(async ({ input, errors, context }) => {
    const [row] = await db().delete(codingLog).where(eq(codingLog.id, input.params.id)).returning({ id: codingLog.id })
    if (!row) throw errors.NOT_FOUND()
    logOperation(context, 'deleted', { id: row.id })
  }),
}

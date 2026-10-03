import { and, desc, eq, type SQL, sql } from 'drizzle-orm'
import { career } from '../../db/schema'
import { languagesOf } from '../../domain/languages'
import { missingForPublish, transitionOf } from '../../domain/publishing'
import { admin, db, logOperation, logTransition, toIso } from './base'

type CareerRow = typeof career.$inferSelect

function toOutput(row: CareerRow) {
  const ja = { title: row.titleJa, organization: row.organizationJa, location: row.locationJa, body: row.bodyJa }
  const en = { title: row.titleEn, organization: row.organizationEn, location: row.locationEn, body: row.bodyEn }
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    startDate: row.startDate,
    endDate: row.endDate,
    ja,
    en,
    languages: languagesOf('title', ja, en),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  }
}

interface CareerInput {
  status: 'draft' | 'published'
  kind: 'work' | 'education'
  startDate: string | null
  endDate: string | null
  ja: { title: string | null; organization: string | null; location: string | null; body: string | null }
  en: { title: string | null; organization: string | null; location: string | null; body: string | null }
}

function toValues(input: CareerInput) {
  return {
    status: input.status,
    kind: input.kind,
    startDate: input.startDate,
    endDate: input.endDate,
    titleJa: input.ja.title,
    titleEn: input.en.title,
    organizationJa: input.ja.organization,
    organizationEn: input.en.organization,
    locationJa: input.ja.location,
    locationEn: input.en.location,
    bodyJa: input.ja.body,
    bodyEn: input.en.body,
  }
}

const missingOf = (input: CareerInput) => (input.status === 'published' ? missingForPublish('career', input) : [])

export const careers = {
  list: admin.careers.list.handler(async ({ input }) => {
    const conditions: SQL[] = []
    if (input.status) conditions.push(eq(career.status, input.status))
    if (input.kind) conditions.push(eq(career.kind, input.kind))
    const rows = await db()
      .select()
      .from(career)
      .where(and(...conditions))
      // 開始年月が空の下書きを先頭に、続けて開始年月の新しい順（design-spec 6.6）
      .orderBy(sql`${career.startDate} is null desc`, desc(career.startDate), desc(career.updatedAt))
    return {
      items: rows.map((row) => {
        const { ja, en, languages, createdAt: _, ...rest } = toOutput(row)
        return {
          ...rest,
          ja: { title: ja.title, organization: ja.organization },
          en: { title: en.title, organization: en.organization },
          languages,
        }
      }),
    }
  }),

  create: admin.careers.create.handler(async ({ input, errors, context }) => {
    const missing = missingOf(input)
    if (missing.length > 0) throw errors.PUBLISH_REQUIREMENTS_NOT_MET({ data: { missing } })
    const [row] = await db().insert(career).values(toValues(input)).returning()
    if (!row) throw new Error('経歴の作成で行が返らない')
    logTransition(context, transitionOf(null, input.status), row.id)
    return toOutput(row)
  }),

  get: admin.careers.get.handler(async ({ input, errors }) => {
    const row = await db().select().from(career).where(eq(career.id, input.params.id)).get()
    if (!row) throw errors.NOT_FOUND()
    return toOutput(row)
  }),

  update: admin.careers.update.handler(async ({ input: { params, body: input }, errors, context }) => {
    const d = db()
    const current = await d.select({ status: career.status }).from(career).where(eq(career.id, params.id)).get()
    if (!current) throw errors.NOT_FOUND()
    const missing = missingOf(input)
    if (missing.length > 0) throw errors.PUBLISH_REQUIREMENTS_NOT_MET({ data: { missing } })
    const [row] = await d.update(career).set(toValues(input)).where(eq(career.id, params.id)).returning()
    if (!row) throw errors.NOT_FOUND()
    logTransition(context, transitionOf(current.status, input.status), row.id)
    return toOutput(row)
  }),

  remove: admin.careers.remove.handler(async ({ input, errors, context }) => {
    const [row] = await db().delete(career).where(eq(career.id, input.params.id)).returning({ id: career.id })
    if (!row) throw errors.NOT_FOUND()
    logOperation(context, 'deleted', { id: row.id })
  }),
}

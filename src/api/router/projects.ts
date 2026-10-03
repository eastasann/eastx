import { asc, eq, sql } from 'drizzle-orm'
import { project, projectStack } from '../../db/schema'
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

type ProjectRow = typeof project.$inferSelect

interface ProjectInput {
  status: Status
  slug: string | null
  ja: { title: string | null; summary: string | null; body: string | null }
  en: { title: string | null; summary: string | null; body: string | null }
  linkUrl: string | null
  startDate: string | null
  endDate: string | null
  thumbnailUrl: string | null
  stackIds: string[]
}

function toValues(input: ProjectInput) {
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
    startDate: input.startDate,
    endDate: input.endDate,
    thumbnailUrl: input.thumbnailUrl,
  }
}

async function readProject(id: string) {
  const row = await db().select().from(project).where(eq(project.id, id)).get()
  if (!row) return null
  const stacks = await readLinkedStacks('project', id)
  const ja = { title: row.titleJa, summary: row.summaryJa, body: row.bodyJa }
  const en = { title: row.titleEn, summary: row.summaryEn, body: row.bodyEn }
  return {
    id: row.id,
    status: row.status,
    slug: row.slug,
    ja,
    en,
    linkUrl: row.linkUrl,
    startDate: row.startDate,
    endDate: row.endDate,
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

function toListItem(row: ProjectRow) {
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
    startDate: row.startDate,
    endDate: row.endDate,
    updatedAt: toIso(row.updatedAt),
  }
}

/** 保存の前の確かめ（公開のルール・使用技術の存在・スラッグの重複） */
async function validateSave(input: ProjectInput, excludeId?: string) {
  if (input.status === 'published') {
    const missing = missingForPublish('project', input)
    if (missing.length > 0) throw publishRequirementsNotMet(missing)
  }
  await assertStacksExist(input.stackIds)
  const suggestion = await slugConflictSuggestion('project', input.slug, excludeId)
  if (suggestion !== null) throw slugConflict(suggestion)
}

function stackLinkInserts(projectId: string, stackIds: readonly string[]) {
  const d = db()
  // 1つの文のパラメーターは100個までなので、1行ずつ入れる（ADR-006）
  return stackIds.map((stackId, i) => d.insert(projectStack).values({ projectId, stackId, sortOrder: i }))
}

/** 一意インデックスの違反（確かめてから書くまでのあいだの競合）を SLUG_CONFLICT にする（ADR-006） */
async function rethrowSlugConflict(error: unknown, slug: string | null, excludeId?: string): Promise<never> {
  if (slug !== null && isUniqueViolation(error, 'project.slug')) {
    throw slugConflict(await availableSlug('project', slug, excludeId))
  }
  throw error
}

export const projects = {
  list: admin.projects.list.handler(async ({ input }) => {
    const rows = await db()
      .select()
      .from(project)
      .where(input.status ? eq(project.status, input.status) : undefined)
      .orderBy(asc(project.sortOrder), asc(project.createdAt))
    return { items: rows.map(toListItem) }
  }),

  create: admin.projects.create.handler(async ({ input, context }) => {
    await validateSave(input)
    const d = db()
    const id = crypto.randomUUID()
    const now = new Date()
    try {
      // 新規作成は先頭に入れる（今の最小値 − 1。SDD 6.1）。最小値は同じ文の中で読み、確かめてから書くあいだを作らない
      await d.batch([
        d.insert(project).values({
          ...toValues(input),
          id,
          sortOrder: sql`(select coalesce(min(${project.sortOrder}), 1) - 1 from ${project})`,
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
    const result = await readProject(id)
    if (!result) throw new Error('プロジェクトの作成の直後に行が読めない')
    return result
  }),

  get: admin.projects.get.handler(async ({ input, errors }) => {
    const result = await readProject(input.params.id)
    if (!result) throw errors.NOT_FOUND()
    return result
  }),

  update: admin.projects.update.handler(async ({ input: { params, body: input }, errors, context }) => {
    const d = db()
    const current = await d
      .select({ status: project.status, firstPublishedAt: project.firstPublishedAt })
      .from(project)
      .where(eq(project.id, params.id))
      .get()
    if (!current) throw errors.NOT_FOUND()
    await validateSave(input, params.id)
    try {
      // プロジェクトの更新と project_stack の置き換えは、1回の batch でまとめて確定する（ADR-006）
      await d.batch([
        d
          .update(project)
          .set({
            ...toValues(input),
            firstPublishedAt: firstPublishedAtAfterSave(current.firstPublishedAt, input.status, new Date()),
          })
          .where(eq(project.id, params.id)),
        d.delete(projectStack).where(eq(projectStack.projectId, params.id)),
        ...stackLinkInserts(params.id, input.stackIds),
      ])
    } catch (e) {
      // 確かめてから書くまでのあいだにプロジェクトか使用技術が消えた（ADR-006）
      if (isForeignKeyViolation(e)) {
        if (!(await readProject(params.id))) throw errors.NOT_FOUND()
        throw stacksMissing()
      }
      await rethrowSlugConflict(e, input.slug, params.id)
    }
    logTransition(context, transitionOf(current.status, input.status), params.id)
    const result = await readProject(params.id)
    if (!result) throw errors.NOT_FOUND()
    return result
  }),

  remove: admin.projects.remove.handler(async ({ input, errors, context }) => {
    // project_stack の紐づけは ON DELETE CASCADE で消える
    const [row] = await db().delete(project).where(eq(project.id, input.params.id)).returning({ id: project.id })
    if (!row) throw errors.NOT_FOUND()
    logOperation(context, 'deleted', { id: row.id })
  }),

  reorder: admin.projects.reorder.handler(async ({ input, errors }) => {
    const d = db()
    const rows = await d.select({ id: project.id }).from(project)
    const current = new Set(rows.map((row) => row.id))
    if (rows.length !== input.ids.length || !input.ids.every((id) => current.has(id))) {
      throw errors.ORDER_OUT_OF_DATE()
    }
    const [first, ...rest] = input.ids.map((id, i) =>
      // updated_at に今の値をそのまま入れて、$onUpdateFn で変わらないようにする（SDD 6.1）
      d
        .update(project)
        .set({ sortOrder: i, updatedAt: sql`${project.updatedAt}` })
        .where(eq(project.id, id)),
    )
    if (first) await d.batch([first, ...rest])
    return { ids: input.ids }
  }),
}

import { count, desc, eq } from 'drizzle-orm'
import { blogPost, career, codingLog, project, stack, work } from '../../db/schema'
import { admin, db, toIso } from './base'

/** 下書きの一覧に出す件数（design-spec 6.5） */
const DRAFT_LIST_LIMIT = 10

const DRAFT_SOURCES = [
  ['career', career],
  ['project', project],
  ['work', work],
  ['blog-post', blogPost],
  ['coding-log', codingLog],
] as const

export const dashboard = {
  get: admin.dashboard.get.handler(async () => {
    const d = db()
    const statusCounts = (table: (typeof DRAFT_SOURCES)[number][1]) =>
      d.select({ status: table.status, n: count() }).from(table).groupBy(table.status)
    // 種類ごとに最新の10件まで読めば、全種類を合わせた最新の10件は必ずその中にある
    const latestDrafts = (table: (typeof DRAFT_SOURCES)[number][1]) =>
      d
        .select({ id: table.id, titleJa: table.titleJa, titleEn: table.titleEn, updatedAt: table.updatedAt })
        .from(table)
        .where(eq(table.status, 'draft'))
        .orderBy(desc(table.updatedAt))
        .limit(DRAFT_LIST_LIMIT)

    const [stackTotal, ...rest] = await d.batch([
      d.select({ n: count() }).from(stack),
      ...DRAFT_SOURCES.map(([, table]) => statusCounts(table)),
      ...DRAFT_SOURCES.map(([, table]) => latestDrafts(table)),
    ])
    const countRows = rest.slice(0, DRAFT_SOURCES.length) as { status: string; n: number }[][]
    const draftRows = rest.slice(DRAFT_SOURCES.length) as {
      id: string
      titleJa: string | null
      titleEn: string | null
      updatedAt: Date
    }[][]

    const counts = countRows.map((rows) => ({
      published: rows.find((r) => r.status === 'published')?.n ?? 0,
      draft: rows.find((r) => r.status === 'draft')?.n ?? 0,
    }))
    const [careers, projects, works, blogPosts, codingLogs] = counts as [
      (typeof counts)[number],
      (typeof counts)[number],
      (typeof counts)[number],
      (typeof counts)[number],
      (typeof counts)[number],
    ]

    const items = DRAFT_SOURCES.flatMap(([type], i) =>
      (draftRows[i] ?? []).map((row) => ({
        type,
        id: row.id,
        title: { ja: row.titleJa, en: row.titleEn },
        updatedAt: row.updatedAt,
      })),
    )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, DRAFT_LIST_LIMIT)
      .map((item) => ({ ...item, updatedAt: toIso(item.updatedAt) }))

    return {
      counts: { careers, projects, works, stacks: { total: stackTotal[0]?.n ?? 0 }, blogPosts, codingLogs },
      drafts: { items, total: counts.reduce((sum, c) => sum + c.draft, 0) },
    }
  }),
}

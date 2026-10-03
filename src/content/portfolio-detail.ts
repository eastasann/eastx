/**
 * P2 作品詳細・P3 プロジェクト詳細の中身（SDD 5.11 の getWorkDetail・getProjectDetail、design-spec 6.2）。
 * スラッグが存在しない・非公開・詳細本文がないときは notFound()（C1）
 */
import { notFound } from '@tanstack/react-router'
import { and, asc, eq } from 'drizzle-orm'
import { project, projectStack, stack, work, workStack } from '~/db/schema'
import { excerptOf } from '~/domain/excerpt'
import type { Lang } from '~/i18n/detect'
import { getMessages } from '~/i18n/messages'
import { availabilityOf, type Bilingual, type LocalizedHtml, pickText } from './localize'
import { renderLocalizedMarkdown } from './markdown'
import { pageMeta, titleWithSiteName } from './meta'
import { published } from './published'
import { type ContentContext, hasDetailSql, required } from './shared'
import type { Neighbor, PageMeta, ProjectDetailView, StackChip, WorkDetailView } from './types'

export interface DetailInput {
  lang: Lang
  slug: string
}

const stackColumns = {
  key: stack.key,
  displayName: stack.displayName,
  iconUrl: stack.iconUrl,
  linkUrl: stack.linkUrl,
}

interface NeighborRow {
  id: string
  slug: string | null
  titleJa: string | null
  titleEn: string | null
}

/** 表示順に並んだ「詳細ページを持つ公開中」の中から、前後の項目を出す */
function neighborsOf(rows: NeighborRow[], id: string, lang: Lang): { prev: Neighbor; next: Neighbor } {
  const index = rows.findIndex((row) => row.id === id)
  const toNeighbor = (row: NeighborRow | undefined): Neighbor => {
    if (!row) return null
    const { lang: primary } = availabilityOf('title', lang, { ja: { title: row.titleJa }, en: { title: row.titleEn } })
    return {
      slug: required(row.slug, 'slug'),
      title: required(pickText(primary, { ja: row.titleJa, en: row.titleEn }), 'title'),
    }
  }
  return { prev: toNeighbor(rows[index - 1]), next: toNeighbor(rows[index + 1]) }
}

interface DetailRow {
  id: string
  slug: string | null
  titleJa: string | null
  titleEn: string | null
  summaryJa: string | null
  summaryEn: string | null
  bodyJa: string | null
  bodyEn: string | null
  thumbnailUrl: string | null
  updatedAt: Date
}

async function commonDetail(
  { siteUrl }: ContentContext,
  { lang, slug }: DetailInput,
  kind: 'work' | 'project',
  row: DetailRow,
): Promise<{
  title: WorkDetailView['title']
  availability: WorkDetailView['availability']
  body: LocalizedHtml
  meta: PageMeta
}> {
  const availability = availabilityOf('title', lang, { ja: { title: row.titleJa }, en: { title: row.titleEn } })
  const primary = availability.lang
  const bodies: Bilingual<string | null> = { ja: row.bodyJa, en: row.bodyEn }
  // 呼び出し側が、詳細本文のある行だけを渡す（ない行は notFound にしてある）
  const body = required(
    await renderLocalizedMarkdown({ kind, id: row.id, updatedAt: row.updatedAt }, primary, bodies, siteUrl),
    `${kind}.body`,
  )
  const title = required(pickText(primary, { ja: row.titleJa, en: row.titleEn }), `${kind}.title`)
  const bodyText = pickText(primary, bodies)
  const description =
    pickText(primary, { ja: row.summaryJa, en: row.summaryEn })?.value ??
    (bodyText ? excerptOf(bodyText.value, bodyText.lang) : null)
  const meta = pageMeta({
    siteUrl,
    lang,
    path: `/${kind === 'work' ? 'works' : 'projects'}/${slug}`,
    title: titleWithSiteName(title.value, getMessages(lang).siteName),
    description,
    imagePath: row.thumbnailUrl,
  })
  return { title, availability, body, meta }
}

export async function loadWorkDetail(context: ContentContext, input: DetailInput): Promise<WorkDetailView> {
  const { db } = context
  const target = and(eq(work.slug, input.slug), published(work))
  const [rows, stacks, ordered] = await db.batch([
    db
      .select({
        id: work.id,
        slug: work.slug,
        titleJa: work.titleJa,
        titleEn: work.titleEn,
        summaryJa: work.summaryJa,
        summaryEn: work.summaryEn,
        bodyJa: work.bodyJa,
        bodyEn: work.bodyEn,
        thumbnailUrl: work.thumbnailUrl,
        linkUrl: work.linkUrl,
        githubUrl: work.githubUrl,
        updatedAt: work.updatedAt,
      })
      .from(work)
      .where(target)
      .limit(1),
    db
      .select(stackColumns)
      .from(workStack)
      .innerJoin(stack, eq(workStack.stackId, stack.id))
      .innerJoin(work, eq(workStack.workId, work.id))
      .where(target)
      .orderBy(asc(workStack.sortOrder)),
    db
      .select({ id: work.id, slug: work.slug, titleJa: work.titleJa, titleEn: work.titleEn })
      .from(work)
      .where(and(published(work), hasDetailSql(work)))
      .orderBy(asc(work.sortOrder), asc(work.id)),
  ])
  const row = rows[0]
  if (!row || (row.bodyJa === null && row.bodyEn === null)) throw notFound()
  const common = await commonDetail(context, input, 'work', row)
  return {
    lang: input.lang,
    ...common,
    id: row.id,
    slug: input.slug,
    thumbnailUrl: row.thumbnailUrl,
    linkUrl: row.linkUrl,
    githubUrl: row.githubUrl,
    stacks: stacks satisfies StackChip[],
    ...neighborsOf(ordered, row.id, input.lang),
  }
}

export async function loadProjectDetail(context: ContentContext, input: DetailInput): Promise<ProjectDetailView> {
  const { db } = context
  const target = and(eq(project.slug, input.slug), published(project))
  const [rows, stacks, ordered] = await db.batch([
    db
      .select({
        id: project.id,
        slug: project.slug,
        titleJa: project.titleJa,
        titleEn: project.titleEn,
        summaryJa: project.summaryJa,
        summaryEn: project.summaryEn,
        bodyJa: project.bodyJa,
        bodyEn: project.bodyEn,
        thumbnailUrl: project.thumbnailUrl,
        linkUrl: project.linkUrl,
        startDate: project.startDate,
        endDate: project.endDate,
        updatedAt: project.updatedAt,
      })
      .from(project)
      .where(target)
      .limit(1),
    db
      .select(stackColumns)
      .from(projectStack)
      .innerJoin(stack, eq(projectStack.stackId, stack.id))
      .innerJoin(project, eq(projectStack.projectId, project.id))
      .where(target)
      .orderBy(asc(projectStack.sortOrder)),
    db
      .select({ id: project.id, slug: project.slug, titleJa: project.titleJa, titleEn: project.titleEn })
      .from(project)
      .where(and(published(project), hasDetailSql(project)))
      .orderBy(asc(project.sortOrder), asc(project.id)),
  ])
  const row = rows[0]
  if (!row || (row.bodyJa === null && row.bodyEn === null)) throw notFound()
  const common = await commonDetail(context, input, 'project', row)
  return {
    lang: input.lang,
    ...common,
    id: row.id,
    slug: input.slug,
    period: { start: required(row.startDate, 'project.start_date'), end: row.endDate },
    thumbnailUrl: row.thumbnailUrl,
    linkUrl: row.linkUrl,
    stacks: stacks satisfies StackChip[],
    ...neighborsOf(ordered, row.id, input.lang),
  }
}

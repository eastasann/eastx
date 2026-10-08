/**
 * P1 トップの中身（SDD 5.11 の getTopPage、design-spec 6.1.3〜6.1.5）。全セクションを1回の db.batch() で読む
 */
import { asc, desc, eq } from 'drizzle-orm'
import {
  blogPost,
  career,
  codingLog,
  profile,
  project,
  projectStack,
  socialLink,
  stack,
  work,
  workStack,
} from '~/db/schema'
import { excerptOf } from '~/domain/excerpt'
import type { Lang } from '~/i18n/detect'
import { getMessages } from '~/i18n/messages'
import { availabilityOf, type Bilingual, type LocalizedText, pickText } from './localize'
import { renderLocalizedMarkdown } from './markdown'
import { pageMeta } from './meta'
import { published } from './published'
import { bodyPresence, type ContentContext, hasDetailSql, required } from './shared'
import type { BlogPostItem, StackChip, TopPageView } from './types'

const stackColumns = {
  key: stack.key,
  displayName: stack.displayName,
  iconUrl: stack.iconUrl,
  linkUrl: stack.linkUrl,
}

/** 中身ごとにまとめる。並び（その中身の中での技術の表示順）はクエリの orderBy のまま保つ */
function groupStacks(rows: ({ ownerId: string } & StackChip)[]): Map<string, StackChip[]> {
  const grouped = new Map<string, StackChip[]>()
  for (const { ownerId, ...chip } of rows) {
    const list = grouped.get(ownerId) ?? []
    list.push(chip)
    grouped.set(ownerId, list)
  }
  return grouped
}

function excerptText(primary: Lang, bodies: Bilingual<string | null>): LocalizedText | null {
  const picked = pickText(primary, bodies)
  if (picked === null) return null
  const value = excerptOf(picked.value, picked.lang)
  return value === null ? null : { value, lang: picked.lang }
}

export async function loadTopPage({ db, siteUrl }: ContentContext, lang: Lang): Promise<TopPageView> {
  const [profiles, links, careers, projects, projectStacks, works, workStacks, stacks, allStacks, posts, logs] =
    await db.batch([
      db
        .select({
          id: profile.id,
          nameJa: profile.nameJa,
          nameEn: profile.nameEn,
          headlineJa: profile.headlineJa,
          headlineEn: profile.headlineEn,
          taglineJa: profile.taglineJa,
          taglineEn: profile.taglineEn,
          bioJa: profile.bioJa,
          bioEn: profile.bioEn,
          avatarUrl: profile.avatarUrl,
          updatedAt: profile.updatedAt,
        })
        .from(profile)
        .limit(1),
      db
        .select({ service: socialLink.service, url: socialLink.url, label: socialLink.label })
        .from(socialLink)
        .orderBy(asc(socialLink.sortOrder)),
      db
        .select({
          id: career.id,
          kind: career.kind,
          titleJa: career.titleJa,
          titleEn: career.titleEn,
          organizationJa: career.organizationJa,
          organizationEn: career.organizationEn,
          locationJa: career.locationJa,
          locationEn: career.locationEn,
          bodyJa: career.bodyJa,
          bodyEn: career.bodyEn,
          startDate: career.startDate,
          endDate: career.endDate,
          updatedAt: career.updatedAt,
        })
        .from(career)
        .where(published(career))
        .orderBy(desc(career.startDate), asc(career.id)),
      db
        .select({
          id: project.id,
          slug: project.slug,
          titleJa: project.titleJa,
          titleEn: project.titleEn,
          summaryJa: project.summaryJa,
          summaryEn: project.summaryEn,
          startDate: project.startDate,
          endDate: project.endDate,
          thumbnailUrl: project.thumbnailUrl,
          linkUrl: project.linkUrl,
          hasDetail: hasDetailSql(project),
        })
        .from(project)
        .where(published(project))
        .orderBy(asc(project.sortOrder), asc(project.id)),
      db
        .select({ ownerId: projectStack.projectId, ...stackColumns })
        .from(projectStack)
        .innerJoin(stack, eq(projectStack.stackId, stack.id))
        .innerJoin(project, eq(projectStack.projectId, project.id))
        .where(published(project))
        .orderBy(asc(projectStack.sortOrder)),
      db
        .select({
          id: work.id,
          slug: work.slug,
          titleJa: work.titleJa,
          titleEn: work.titleEn,
          summaryJa: work.summaryJa,
          summaryEn: work.summaryEn,
          thumbnailUrl: work.thumbnailUrl,
          linkUrl: work.linkUrl,
          githubUrl: work.githubUrl,
          hasDetail: hasDetailSql(work),
        })
        .from(work)
        .where(published(work))
        .orderBy(asc(work.sortOrder), asc(work.id)),
      db
        .select({ ownerId: workStack.workId, ...stackColumns })
        .from(workStack)
        .innerJoin(stack, eq(workStack.stackId, stack.id))
        .innerJoin(work, eq(workStack.workId, work.id))
        .where(published(work))
        .orderBy(asc(workStack.sortOrder)),
      db.select(stackColumns).from(stack).where(eq(stack.showOnTop, true)).orderBy(asc(stack.sortOrder)),
      // 自己紹介の太字との照合は「トップに表示する」に関わらず全件（ADR-012）
      db.select({ key: stack.key, displayName: stack.displayName, iconUrl: stack.iconUrl }).from(stack),
      db
        .select({
          id: blogPost.id,
          slug: blogPost.slug,
          titleJa: blogPost.titleJa,
          titleEn: blogPost.titleEn,
          bodyJa: bodyPresence(blogPost.bodyJa),
          bodyEn: bodyPresence(blogPost.bodyEn),
          publishedAt: blogPost.publishedAt,
        })
        .from(blogPost)
        .where(published(blogPost))
        .orderBy(desc(blogPost.publishedAt), asc(blogPost.id)),
      db
        .select({
          id: codingLog.id,
          slug: codingLog.slug,
          kind: codingLog.kind,
          titleJa: codingLog.titleJa,
          titleEn: codingLog.titleEn,
          bodyJa: bodyPresence(codingLog.bodyJa),
          bodyEn: bodyPresence(codingLog.bodyEn),
          publishedAt: codingLog.publishedAt,
        })
        .from(codingLog)
        .where(published(codingLog))
        .orderBy(desc(codingLog.publishedAt), asc(codingLog.id)),
    ])

  const projectStacksById = groupStacks(projectStacks)
  const workStacksById = groupStacks(workStacks)

  const profileRow = profiles[0]
  const profileView = profileRow
    ? {
        // プロフィールは中身全体の代替をせず、項目単位の代替表示だけで出す（design-spec 1.4）
        name: pickText(lang, { ja: profileRow.nameJa, en: profileRow.nameEn }),
        headline: pickText(lang, { ja: profileRow.headlineJa, en: profileRow.headlineEn }),
        tagline: pickText(lang, { ja: profileRow.taglineJa, en: profileRow.taglineEn }),
        bio: await renderLocalizedMarkdown(
          { kind: 'profile', id: profileRow.id, updatedAt: profileRow.updatedAt },
          lang,
          { ja: profileRow.bioJa, en: profileRow.bioEn },
          siteUrl,
          allStacks,
        ),
        avatarUrl: profileRow.avatarUrl,
        socialLinks: links,
      }
    : null

  const careerItems = await Promise.all(
    careers.map(async (row) => {
      const availability = availabilityOf('title', lang, {
        ja: { title: row.titleJa },
        en: { title: row.titleEn },
      })
      const primary = availability.lang
      return {
        id: row.id,
        kind: row.kind,
        period: { start: required(row.startDate, 'career.start_date'), end: row.endDate },
        title: required(pickText(primary, { ja: row.titleJa, en: row.titleEn }), 'career.title'),
        organization: pickText(primary, { ja: row.organizationJa, en: row.organizationEn }),
        location: pickText(primary, { ja: row.locationJa, en: row.locationEn }),
        body: await renderLocalizedMarkdown(
          { kind: 'career', id: row.id, updatedAt: row.updatedAt },
          primary,
          { ja: row.bodyJa, en: row.bodyEn },
          siteUrl,
        ),
        availability,
      }
    }),
  )

  const projectItems = projects.map((row) => {
    const availability = availabilityOf('title', lang, { ja: { title: row.titleJa }, en: { title: row.titleEn } })
    const primary = availability.lang
    return {
      id: row.id,
      slug: required(row.slug, 'project.slug'),
      title: required(pickText(primary, { ja: row.titleJa, en: row.titleEn }), 'project.title'),
      summary: pickText(primary, { ja: row.summaryJa, en: row.summaryEn }),
      period: { start: required(row.startDate, 'project.start_date'), end: row.endDate },
      thumbnailUrl: row.thumbnailUrl,
      linkUrl: row.linkUrl,
      hasDetail: row.hasDetail,
      stacks: projectStacksById.get(row.id) ?? [],
      availability,
    }
  })

  const workItems = works.map((row) => {
    const availability = availabilityOf('title', lang, { ja: { title: row.titleJa }, en: { title: row.titleEn } })
    const primary = availability.lang
    return {
      id: row.id,
      slug: required(row.slug, 'work.slug'),
      title: required(pickText(primary, { ja: row.titleJa, en: row.titleEn }), 'work.title'),
      summary: pickText(primary, { ja: row.summaryJa, en: row.summaryEn }),
      thumbnailUrl: row.thumbnailUrl,
      linkUrl: row.linkUrl,
      githubUrl: row.githubUrl,
      hasDetail: row.hasDetail,
      stacks: workStacksById.get(row.id) ?? [],
      availability,
    }
  })

  const toPostItem = (row: (typeof posts)[number], table: string): BlogPostItem => {
    const availability = availabilityOf('titleAndBody', lang, {
      ja: { title: row.titleJa, body: row.bodyJa },
      en: { title: row.titleEn, body: row.bodyEn },
    })
    const primary = availability.lang
    return {
      id: row.id,
      slug: required(row.slug, `${table}.slug`),
      publishedAt: required(row.publishedAt, `${table}.published_at`).toISOString(),
      title: required(pickText(primary, { ja: row.titleJa, en: row.titleEn }), `${table}.title`),
      availability,
    }
  }

  const messages = getMessages(lang)
  const name = profileView?.name?.value
  return {
    lang,
    meta: pageMeta({
      siteUrl,
      lang,
      path: '',
      title: name ? `${messages.siteName} — ${name}` : messages.siteName,
      // ADR-019
      description:
        profileView?.headline?.value ??
        (profileRow ? (excerptText(lang, { ja: profileRow.bioJa, en: profileRow.bioEn })?.value ?? null) : null),
      imagePath: null,
    }),
    profile: profileView,
    careers: careerItems,
    projects: projectItems,
    works: workItems,
    stacks,
    blogPosts: posts.map((row) => toPostItem(row, 'blog_post')),
    codingLogs: logs.map((row) => ({ ...toPostItem(row, 'coding_log'), kind: row.kind })),
  }
}

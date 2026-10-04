/**
 * ヘッダーとフッターの中身を D1 から読む（SDD 5.11）。形は site-chrome.ts
 */
import { asc, eq } from 'drizzle-orm'
import type { Db } from '~/db/client'
import { blogPost, career, codingLog, profile, project, socialLink, stack, work } from '~/db/schema'
import { published } from './published'
import { MENU_SECTIONS, type SectionId, type SiteChromeView } from './site-chrome'

export async function loadSiteChrome(db: Db): Promise<SiteChromeView> {
  const [careers, projects, works, stacks, posts, logs, profiles, links] = await db.batch([
    db.select({ id: career.id }).from(career).where(published(career)).limit(1),
    db.select({ id: project.id }).from(project).where(published(project)).limit(1),
    db.select({ id: work.id }).from(work).where(published(work)).limit(1),
    // 使用技術は公開状態を持たず、「トップに表示する」の技術が1件以上で出す（SDD 5.11）
    db.select({ id: stack.id }).from(stack).where(eq(stack.showOnTop, true)).limit(1),
    db.select({ id: blogPost.id }).from(blogPost).where(published(blogPost)).limit(1),
    db.select({ id: codingLog.id }).from(codingLog).where(published(codingLog)).limit(1),
    db.select({ id: profile.id }).from(profile).limit(1),
    db
      .select({ service: socialLink.service, url: socialLink.url, label: socialLink.label })
      .from(socialLink)
      .orderBy(asc(socialLink.sortOrder)),
  ])
  const present: Record<SectionId, boolean> = {
    career: careers.length > 0,
    projects: projects.length > 0,
    works: works.length > 0,
    stack: stacks.length > 0,
    blog: posts.length > 0,
    coding: logs.length > 0,
  }
  return { sections: MENU_SECTIONS.filter((id) => present[id]), socialLinks: profiles.length > 0 ? links : [] }
}

/**
 * 公開側の全画面（C1・C2 を含む）のヘッダーとフッターの中身（SDD 5.11 の SiteChromeView、design-spec 6.1.2）
 */
import { asc, eq } from 'drizzle-orm'
import type { Db } from '~/db/client'
import {
  blogPost,
  career,
  codingLog,
  profile,
  project,
  type SOCIAL_SERVICES,
  socialLink,
  stack,
  work,
} from '~/db/schema'
import { published } from './published'

/** トップのセクションのうち、ヘッダーのメニューに出るもの。並びは P1 と同じ（SDD 4.1） */
export const MENU_SECTIONS = ['career', 'projects', 'works', 'stack', 'blog', 'coding'] as const
export type SectionId = (typeof MENU_SECTIONS)[number]

export type SocialService = (typeof SOCIAL_SERVICES)[number]

export interface SiteChromeView {
  /** P1 に出るセクション（中身が1件以上。design-spec 6.1.5） */
  sections: SectionId[]
  /** プロフィールの SNS リンク。並びは管理画面で決めた順。プロフィールがなければ空 */
  socialLinks: { service: SocialService; url: string; label: string | null }[]
}

/** 中身を読めなかったとき（C2・どのルートにも当たらない C1）のヘッダーとフッター。セクションと SNS は出さない */
export const EMPTY_SITE_CHROME: SiteChromeView = { sections: [], socialLinks: [] }

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

/**
 * 公開側のサーバー関数が返す表示用の形（SDD 5.11）。言語の代替は済ませてあり、画面は `lang` 属性を付けるだけ
 */
import type { CODING_LOG_KINDS } from '~/db/schema'
import type { Lang } from '~/i18n/detect'
import type { Availability, LocalizedHtml, LocalizedText } from './localize'
import type { SocialService } from './site-chrome'

export type CodingLogKind = (typeof CODING_LOG_KINDS)[number]

export interface StackChip {
  key: string
  displayName: string
  iconUrl: string | null
  linkUrl: string | null
}

/** 年月は `YYYY-MM`。終わりが null なら現在まで */
export interface Period {
  start: string
  end: string | null
}

/** 詳細ページの前後のナビの1件。端の項目では null */
export type Neighbor = { slug: string; title: LocalizedText } | null

export interface PageMeta {
  title: string
  description: string | null
  /** 絶対 URL（ADR-019） */
  ogImageUrl: string
  /** 言語ごとのこのページの絶対 URL。canonical と hreflang に使う */
  alternates: Record<Lang, string>
}

export interface SocialLinkView {
  service: SocialService
  url: string
  label: string | null
}

export interface ProfileView {
  name: LocalizedText | null
  headline: LocalizedText | null
  bio: LocalizedHtml | null
  avatarUrl: string | null
  socialLinks: SocialLinkView[]
}

export interface CareerItem {
  id: string
  kind: 'work' | 'education'
  period: Period
  title: LocalizedText
  organization: LocalizedText | null
  location: LocalizedText | null
  body: LocalizedHtml | null
  availability: Availability
}

export interface ProjectItem {
  id: string
  slug: string
  title: LocalizedText
  summary: LocalizedText | null
  period: Period
  thumbnailUrl: string | null
  linkUrl: string | null
  hasDetail: boolean
  stacks: StackChip[]
  availability: Availability
}

export interface WorkItem {
  id: string
  slug: string
  title: LocalizedText
  summary: LocalizedText | null
  thumbnailUrl: string | null
  linkUrl: string | null
  githubUrl: string | null
  hasDetail: boolean
  stacks: StackChip[]
  availability: Availability
}

export interface BlogPostItem {
  id: string
  slug: string
  /** ISO 8601 */
  publishedAt: string
  title: LocalizedText
  excerpt: LocalizedText | null
  thumbnailUrl: string | null
  availability: Availability
}

export interface CodingLogItem extends BlogPostItem {
  kind: CodingLogKind
}

export interface TopPageView {
  lang: Lang
  meta: PageMeta
  profile: ProfileView | null
  careers: CareerItem[]
  projects: ProjectItem[]
  works: WorkItem[]
  /** 「トップに表示する」の技術だけ、表示順 */
  stacks: StackChip[]
  blogPosts: BlogPostItem[]
  codingLogs: CodingLogItem[]
}

export interface WorkDetailView {
  lang: Lang
  meta: PageMeta
  id: string
  slug: string
  title: LocalizedText
  availability: Availability
  /** body.lang が lang と違えば、本文の上に注記を出す（design-spec 6.2.3） */
  body: LocalizedHtml
  thumbnailUrl: string | null
  linkUrl: string | null
  githubUrl: string | null
  stacks: StackChip[]
  /** 詳細ページを持つ公開中の作品の、表示順の前後 */
  prev: Neighbor
  next: Neighbor
}

export type ProjectDetailView = Omit<WorkDetailView, 'githubUrl'> & { period: Period }

export interface BlogPostView {
  lang: Lang
  meta: PageMeta
  id: string
  slug: string
  title: LocalizedText
  /** body.lang が lang と違えば、本文の上に注記を出す（design-spec 6.3） */
  body: LocalizedHtml
  availability: Availability
  /** ISO 8601 */
  publishedAt: string
  /** 公開日より後のときだけ入る（design-spec 6.3） */
  contentUpdatedAt: string | null
  thumbnailUrl: string | null
  /** 公開中の中で、公開日の1つ新しいもの・1つ古いもの */
  newer: Neighbor
  older: Neighbor
}

export type CodingLogView = BlogPostView & { kind: CodingLogKind; referenceUrl: string | null }

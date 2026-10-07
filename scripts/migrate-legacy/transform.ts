/**
 * 今のサイトのデータを SDD 6章の形に変換する（SDD 6.5 の対応、design-spec 9章の方針）。
 * 画像の取得とファイルの書き出しは migrate.ts が行い、ここは入力から行を作るだけの純粋な関数にする。
 */
import { LIMITS } from '../../src/api/contract/common'
import type { career, profile, project, projectStack, socialLink, stack, work, workStack } from '../../src/db/schema'
import { firstAvailable, slugify, stackKeyBase } from '../../src/domain/slug'
import type { LegacyResume, LegacyStack } from './legacy'

export type MigrationData = {
  profile: (typeof profile.$inferInsert)[]
  socialLinks: (typeof socialLink.$inferInsert)[]
  careers: (typeof career.$inferInsert)[]
  stacks: (typeof stack.$inferInsert)[]
  works: (typeof work.$inferInsert)[]
  workStacks: (typeof workStack.$inferInsert)[]
  projects: (typeof project.$inferInsert)[]
  projectStacks: (typeof projectStack.$inferInsert)[]
}

/** 今の画像の URL から、R2 に置き直したあとのパス（`/media/uploads/legacy/...`）を返す */
type MediaPathOf = (sourceUrl: string) => string

/** SDD 5.0 と同じく、前後の空白を取り除き、空なら null */
export function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/** 年月は日本時間で数える（CLAUDE.md「日時は Asia/Tokyo」）。今の DB は月初めの 0 時（UTC）で持っている */
export function toYearMonth(iso: string | null): string | null {
  if (iso === null) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(iso))
  const year = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  if (year === undefined || month === undefined) throw new Error(`年月にできない日時: ${iso}`)
  return `${year}-${month}`
}

/** 画像の URL（今の置き場）を、トップに出る順・重複なしで集める。migrate.ts がこの順に取得する */
export function imageSources(resume: LegacyResume): string[] {
  const urls = [resume.profileImage, ...allStacks(resume).map((s) => s.stackImage)]
  return [...new Set(urls.map(clean).filter((u): u is string => u !== null))]
}

/**
 * 使用技術の一覧。トップの「仕事」の欄の順に並べ、「個人開発」の欄にだけあるものをその後ろに足す。
 * 作品・プロジェクトにだけ紐づいて、トップの欄に出ていない技術も落とさない
 */
function allStacks(resume: LegacyResume): LegacyStack[] {
  const byId = new Map<string, LegacyStack>()
  const sources = [
    ...resume.stacks.production,
    ...resume.stacks.sideProject,
    ...resume.works.flatMap((w) => w.stacks),
    ...resume.projects.flatMap((p) => p.stacks),
  ]
  for (const s of sources) if (!byId.has(s.id)) byId.set(s.id, s)
  return [...byId.values()]
}

/**
 * 今の説明（Work.body・Project.body）は概要（summary）に入れる（design-spec 9章）。
 * 概要の上限（SDD 5.0 の 500字）を日英のどちらかが超える中身は、日英とも詳細本文（body）に入れて概要を空にする。
 * 上限を超えた概要は管理画面で保存できず、長い説明はトップの行の概要より詳細ページで読ませる量なので
 */
function descriptionColumns(en: string | null, ja: string | null) {
  const fitsSummary = (en?.length ?? 0) <= LIMITS.summary && (ja?.length ?? 0) <= LIMITS.summary
  return fitsSummary
    ? { summaryEn: en, summaryJa: ja, bodyEn: null, bodyJa: null }
    : { summaryEn: null, summaryJa: null, bodyEn: en, bodyJa: ja }
}

/** 英語のタイトルからスラッグを作る。下書きなので空でもよいが、公開の前に入れ直す手間を省く（design-spec 6.7.2） */
function slugAllocator() {
  const taken = new Set<string>()
  return (titleEn: string | null): string | null => {
    const base = titleEn === null ? null : slugify(titleEn)
    if (base === null) return null
    const slug = firstAvailable(base, (c) => taken.has(c))
    taken.add(slug)
    return slug
  }
}

function httpsOrNull(value: string | null | undefined, where: string): string | null {
  const url = clean(value)
  if (url !== null && !(url.startsWith('https://') && URL.canParse(url))) {
    throw new Error(`${where}: https:// で始まる URL ではない（${url}）`)
  }
  return url
}

/** 1つの中身に同じ技術が2回あると、紐づけの主キー（SDD 6.4）が重なって SQL が途中で失敗する */
function uniqueStackIds(ownerId: string, stacks: LegacyStack[]): string[] {
  const ids = stacks.map((s) => s.id)
  if (new Set(ids).size !== ids.length) throw new Error(`${ownerId}: 同じ使用技術が2回紐づいている`)
  return ids
}

export function transform(resume: LegacyResume, mediaPathOf: MediaPathOf): MigrationData {
  const media = (url: string | null) => {
    const source = clean(url)
    return source === null ? null : mediaPathOf(source)
  }

  const profileRow: typeof profile.$inferInsert = {
    id: resume.id,
    nameJa: clean(resume.nameJp),
    nameEn: clean(resume.name),
    // 肩書きは新しく足した項目で、今の DB に無い（SDD 6.5）
    headlineJa: null,
    headlineEn: null,
    bioJa: clean(resume.descriptionJp),
    bioEn: clean(resume.description),
    avatarUrl: media(resume.profileImage),
    createdAt: new Date(resume.createdAt),
    updatedAt: new Date(resume.updatedAt),
  }

  const sns = [
    { service: 'instagram', url: resume.snsInstagram },
    { service: 'linkedin', url: resume.snsLinkedin },
    { service: 'github', url: resume.snsGithub },
  ] as const
  const socialLinks: MigrationData['socialLinks'] = sns
    .flatMap(({ service, url }) => {
      const value = httpsOrNull(url, `SNS（${service}）`)
      return value === null ? [] : [{ service, url: value }]
    })
    .map((link, i) => ({
      ...link,
      label: null,
      sortOrder: i,
      createdAt: profileRow.createdAt,
      updatedAt: profileRow.updatedAt,
    }))

  // 今の経歴はタイトルだけが日英を持ち、所属・場所は1つの値（英語）を両方の言語のページに出していた。
  // 新しいサイトでも同じ表示になるよう、所属・場所は日英の両方に同じ値を入れる
  const careers: MigrationData['careers'] = [
    ...resume.experiences.map((c) => ({ c, kind: 'work' as const })),
    ...resume.education.map((c) => ({ c, kind: 'education' as const })),
  ].map(({ c, kind }) => ({
    id: c.id,
    kind,
    titleJa: clean(c.titleJp),
    titleEn: clean(c.title),
    organizationJa: clean(c.organization),
    organizationEn: clean(c.organization),
    locationJa: clean(c.location),
    locationEn: clean(c.location),
    bodyJa: clean(c.bodyJp),
    bodyEn: clean(c.body),
    startDate: toYearMonth(c.startDate),
    endDate: toYearMonth(c.endDate),
    status: 'draft',
    createdAt: new Date(c.createdAt),
    updatedAt: new Date(c.updatedAt),
  }))

  const onTop = new Set([...resume.stacks.production, ...resume.stacks.sideProject].map((s) => s.id))
  const stackKeys = new Set<string>()
  const stacks: MigrationData['stacks'] = allStacks(resume).map((s, i) => {
    // 今の name（識別名）は空白や大文字を含む（'atomic design'、'SAP'）ので、識別名の形式（SDD 6.4）に直す
    const key = firstAvailable(stackKeyBase(s.name), (c) => stackKeys.has(c))
    stackKeys.add(key)
    return {
      id: s.id,
      key,
      displayName: clean(s.displayName) ?? s.name,
      iconUrl: media(s.stackImage),
      linkUrl: httpsOrNull(s.link, `使用技術（${s.name}）のリンク`),
      sortOrder: i,
      showOnTop: onTop.has(s.id),
      createdAt: new Date(s.createdAt),
      updatedAt: new Date(s.updatedAt),
    }
  })

  const workSlug = slugAllocator()
  const works: MigrationData['works'] = resume.works.map((w, i) => ({
    id: w.id,
    slug: workSlug(clean(w.title)),
    titleJa: clean(w.titleJp),
    titleEn: clean(w.title),
    ...descriptionColumns(clean(w.body), clean(w.bodyJp)),
    thumbnailUrl: null,
    linkUrl: httpsOrNull(w.link, `作品（${w.title}）の外部リンク`),
    githubUrl: httpsOrNull(w.github, `作品（${w.title}）の GitHub`),
    sortOrder: i,
    status: 'draft',
    firstPublishedAt: null,
    createdAt: new Date(w.createdAt),
    updatedAt: new Date(w.updatedAt),
  }))
  const workStacks: MigrationData['workStacks'] = resume.works.flatMap((w) =>
    uniqueStackIds(w.id, w.stacks).map((stackId, i) => ({ workId: w.id, stackId, sortOrder: i })),
  )

  const projectSlug = slugAllocator()
  const projects: MigrationData['projects'] = resume.projects.map((p, i) => ({
    id: p.id,
    slug: projectSlug(clean(p.title)),
    titleJa: clean(p.titleJp),
    titleEn: clean(p.title),
    ...descriptionColumns(clean(p.body), clean(p.bodyJp)),
    thumbnailUrl: null,
    linkUrl: httpsOrNull(p.link, `プロジェクト（${p.title}）の外部リンク`),
    startDate: toYearMonth(p.startDate),
    endDate: toYearMonth(p.endDate),
    sortOrder: i,
    status: 'draft',
    firstPublishedAt: null,
    createdAt: new Date(p.createdAt),
    updatedAt: new Date(p.updatedAt),
  }))
  const projectStacks: MigrationData['projectStacks'] = resume.projects.flatMap((p) =>
    uniqueStackIds(p.id, p.stacks).map((stackId, i) => ({ projectId: p.id, stackId, sortOrder: i })),
  )

  const data = { profile: [profileRow], socialLinks, careers, stacks, works, workStacks, projects, projectStacks }
  assertEditable(data)
  return data
}

/**
 * 移したものを管理画面でそのまま保存できるよう、CMS API の入力の上限（SDD 5.0）に収まるかを確かめる。
 * DB の CHECK 制約は文字数を見ないので、ここで止めないと、管理画面で開いてから保存できないことに気づく
 */
function assertEditable(data: MigrationData): void {
  const problems: string[] = []
  const check = (where: string, value: string | null | undefined, max: number) => {
    if (value != null && value.length > max) problems.push(`${where}: ${value.length}字（上限 ${max}字）`)
  }
  const short = LIMITS.shortText
  for (const p of data.profile) {
    check('プロフィールの名前（日）', p.nameJa, short)
    check('プロフィールの名前（英）', p.nameEn, short)
    check('プロフィールの自己紹介（日）', p.bioJa, LIMITS.markdown)
    check('プロフィールの自己紹介（英）', p.bioEn, LIMITS.markdown)
  }
  for (const l of data.socialLinks) check(`SNS（${l.service}）`, l.url, LIMITS.url)
  for (const c of data.careers) {
    check(`経歴 ${c.id} のタイトル（日）`, c.titleJa, short)
    check(`経歴 ${c.id} のタイトル（英）`, c.titleEn, short)
    check(`経歴 ${c.id} の所属`, c.organizationEn, short)
    check(`経歴 ${c.id} の場所`, c.locationEn, short)
    check(`経歴 ${c.id} の内容（日）`, c.bodyJa, LIMITS.markdown)
    check(`経歴 ${c.id} の内容（英）`, c.bodyEn, LIMITS.markdown)
  }
  for (const s of data.stacks) {
    check(`使用技術 ${s.key} の表示名`, s.displayName, short)
    check(`使用技術 ${s.key} の識別名`, s.key, LIMITS.slug)
    check(`使用技術 ${s.key} のリンク`, s.linkUrl, LIMITS.url)
  }
  for (const [label, rows] of [
    ['作品', data.works],
    ['プロジェクト', data.projects],
  ] as const) {
    for (const r of rows) {
      check(`${label} ${r.id} のタイトル（日）`, r.titleJa, short)
      check(`${label} ${r.id} のタイトル（英）`, r.titleEn, short)
      check(`${label} ${r.id} の概要（日）`, r.summaryJa, LIMITS.summary)
      check(`${label} ${r.id} の概要（英）`, r.summaryEn, LIMITS.summary)
      check(`${label} ${r.id} の詳細本文（日）`, r.bodyJa, LIMITS.markdown)
      check(`${label} ${r.id} の詳細本文（英）`, r.bodyEn, LIMITS.markdown)
      check(`${label} ${r.id} の外部リンク`, r.linkUrl, LIMITS.url)
    }
  }
  for (const w of data.works) check(`作品 ${w.id} の GitHub`, w.githubUrl, LIMITS.url)
  if (problems.length > 0) throw new Error(`管理画面で保存できない長さの値がある:\n${problems.join('\n')}`)
}

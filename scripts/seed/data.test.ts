import { describe, expect, it } from 'vitest'
import { STACK_CATEGORIES } from '../../src/db/enums'
import { buildSeed } from './data'

// design-spec 8章の表の「件数」と「内容のバリエーション」を1項目ずつ照合する

const seed = buildSeed({ empty: false })
const published = <T extends { status?: string | null }>(rows: T[]) => rows.filter((r) => r.status === 'published')
const hasBody = (r: { bodyJa?: string | null; bodyEn?: string | null }) => !!r.bodyJa || !!r.bodyEn
const hasCode = (r: { bodyJa?: string | null; bodyEn?: string | null }) =>
  `${r.bodyJa ?? ''}${r.bodyEn ?? ''}`.includes('```')

describe('デモデータ（design-spec 8章）', () => {
  it('profile: 1件。日英とも全項目あり、写真あり', () => {
    expect(seed.profile).toHaveLength(1)
    const p = seed.profile[0]
    for (const key of [
      'nameJa',
      'nameEn',
      'headlineJa',
      'headlineEn',
      'taglineJa',
      'taglineEn',
      'bioJa',
      'bioEn',
      'avatarUrl',
    ] as const) {
      expect(p?.[key]).toBeTruthy()
    }
  })

  it('profile: 自己紹介（日英）に、使用技術と一致する太字（React・TypeScript）と一致しない太字が1つ', () => {
    const p = seed.profile[0]
    const names = new Set(seed.stacks.flatMap((s) => [s.key.toLowerCase(), s.displayName.toLowerCase()]))
    for (const bio of [p?.bioJa, p?.bioEn]) {
      const bold = [...(bio ?? '').matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1] ?? '')
      expect(bold.filter((b) => names.has(b.toLowerCase()))).toEqual(['React', 'TypeScript'])
      expect(bold.filter((b) => !names.has(b.toLowerCase()))).toHaveLength(1)
    }
  })

  it('social_link: github・linkedin・x・other（表示名あり）を1件ずつ', () => {
    expect(seed.socialLinks.map((s) => s.service)).toEqual(['github', 'linkedin', 'x', 'other'])
    expect(seed.socialLinks.find((s) => s.service === 'other')?.label).toBeTruthy()
  })

  it('career: 8件（公開7・下書き1）。職歴5・学歴3、「現在」1、長い内容1、英語のみ1', () => {
    expect(seed.careers).toHaveLength(8)
    expect(published(seed.careers)).toHaveLength(7)
    expect(seed.careers.filter((c) => c.kind === 'work')).toHaveLength(5)
    expect(seed.careers.filter((c) => c.kind === 'education')).toHaveLength(3)
    const pub = published(seed.careers)
    expect(pub.filter((c) => c.kind === 'work' && c.endDate == null)).toHaveLength(1)
    expect(pub.filter((c) => (c.bodyJa?.length ?? 0) > 200)).toHaveLength(1)
    expect(pub.filter((c) => !c.titleJa && c.titleEn)).toHaveLength(1)
  })

  it('work: 12件（公開11・下書き1）と、公開11件の内訳', () => {
    expect(seed.works).toHaveLength(12)
    const pub = published(seed.works)
    expect(pub).toHaveLength(11)
    expect(pub.filter(hasBody)).toHaveLength(6)
    const jaOnly = pub.filter((w) => w.bodyJa && !w.bodyEn)
    expect(jaOnly).toHaveLength(1)
    // 日本語の本文だけの1件は表示順の11番目（1ページ10件の2ページ目）
    const ordered = [...pub].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    expect(ordered.indexOf(jaOnly[0] as (typeof pub)[number])).toBe(10)
    const noBody = pub.filter((w) => !hasBody(w))
    expect(noBody.filter((w) => w.linkUrl && !w.githubUrl)).toHaveLength(2)
    expect(noBody.filter((w) => !w.linkUrl && w.githubUrl)).toHaveLength(2)
    expect(noBody.filter((w) => !w.linkUrl && !w.githubUrl)).toHaveLength(1)
    expect(seed.works.filter((w) => w.thumbnailUrl)).toHaveLength(4)
    const stacksPerWork = pub.map((w) => seed.workStacks.filter((ws) => ws.workId === w.id).length)
    expect(stacksPerWork.filter((n) => n >= 7)).toHaveLength(1)
  })

  it('project: 7件（公開6・下書き1）と、公開6件の内訳', () => {
    expect(seed.projects).toHaveLength(7)
    const pub = published(seed.projects)
    expect(pub).toHaveLength(6)
    expect(pub.filter(hasBody)).toHaveLength(3)
    const noBody = pub.filter((p) => !hasBody(p))
    expect(noBody.filter((p) => p.linkUrl)).toHaveLength(2)
    expect(noBody.filter((p) => !p.linkUrl)).toHaveLength(1)
    expect(pub.filter((p) => p.endDate == null)).toHaveLength(1)
    expect(seed.projects.filter((p) => p.thumbnailUrl)).toHaveLength(3)
  })

  it('stack: 16件。アイコンあり14・なし2、トップに出さない2、4カテゴリ、Core 4（どれもトップに出す）', () => {
    expect(seed.stacks).toHaveLength(16)
    expect(seed.stacks.filter((s) => s.iconUrl)).toHaveLength(14)
    expect(seed.stacks.filter((s) => s.showOnTop === false)).toHaveLength(2)
    expect(new Set(seed.stacks.map((s) => s.category))).toEqual(new Set(STACK_CATEGORIES))
    const core = seed.stacks.filter((s) => s.isCore)
    expect(core).toHaveLength(4)
    expect(core.every((s) => s.showOnTop !== false)).toBe(true)
  })

  it('blog_post: 13件（公開12・下書き1）。日英6・日本語のみ4・英語のみ2、更新1、サムネイル5、コード3', () => {
    expect(seed.blogPosts).toHaveLength(13)
    const pub = published(seed.blogPosts)
    expect(pub).toHaveLength(12)
    // ブログの「言語あり」はタイトルと本文の両方（design-spec 1.4）
    const ja = (b: (typeof pub)[number]) => !!b.titleJa && !!b.bodyJa
    const en = (b: (typeof pub)[number]) => !!b.titleEn && !!b.bodyEn
    expect(pub.filter((b) => ja(b) && en(b))).toHaveLength(6)
    expect(pub.filter((b) => ja(b) && !en(b))).toHaveLength(4)
    expect(pub.filter((b) => !ja(b) && en(b))).toHaveLength(2)
    expect(pub.filter((b) => b.contentUpdatedAt != null)).toHaveLength(1)
    expect(seed.blogPosts.filter((b) => b.thumbnailUrl)).toHaveLength(5)
    expect(seed.blogPosts.filter(hasCode)).toHaveLength(3)
  })

  it('coding_log: 12件（公開11・下書き1）。4種類を2件以上、参考リンク3、コード8', () => {
    expect(seed.codingLogs).toHaveLength(12)
    expect(published(seed.codingLogs)).toHaveLength(11)
    for (const kind of ['learning_log', 'snippet', 'problem', 'memo']) {
      expect(published(seed.codingLogs).filter((l) => l.kind === kind).length).toBeGreaterThanOrEqual(2)
    }
    expect(seed.codingLogs.filter((l) => l.referenceUrl)).toHaveLength(3)
    expect(seed.codingLogs.filter(hasCode)).toHaveLength(8)
  })

  it('公開中のスラッグは種類ごとに一意で、公開した日時が入っている', () => {
    for (const slugs of [
      published(seed.works).map((r) => r.slug),
      published(seed.projects).map((r) => r.slug),
      published(seed.blogPosts).map((r) => r.slug),
      published(seed.codingLogs).map((r) => r.slug),
    ]) {
      expect(slugs.every((s) => !!s)).toBe(true)
      expect(new Set(slugs).size).toBe(slugs.length)
    }
    expect(published(seed.works).every((w) => w.firstPublishedAt)).toBe(true)
    expect(published(seed.projects).every((p) => p.firstPublishedAt)).toBe(true)
  })

  it('画像は DB に入るパスごとに1つずつ R2 に置かれる', () => {
    const urls = [
      ...seed.profile.map((p) => p.avatarUrl),
      ...seed.stacks.map((s) => s.iconUrl),
      ...seed.works.map((w) => w.thumbnailUrl),
      ...seed.projects.map((p) => p.thumbnailUrl),
      ...seed.blogPosts.map((b) => b.thumbnailUrl),
    ].filter((u): u is string => !!u)
    expect(seed.images.map((i) => i.url).sort()).toEqual([...urls].sort())
    expect(seed.images.every((i) => /^uploads\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.svg$/.test(i.key))).toBe(true)
  })

  it('空のシードはブログ・コーディング記録だけが0件', () => {
    const empty = buildSeed({ empty: true })
    expect(empty.blogPosts).toHaveLength(0)
    expect(empty.codingLogs).toHaveLength(0)
    expect(empty.works).toHaveLength(12)
  })
})

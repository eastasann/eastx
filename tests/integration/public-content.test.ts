/**
 * 公開側の読み取り（SDD 5.11 の getTopPage・getWorkDetail・getProjectDetail・getBlogPost・getCodingLog。
 * SDD 10章「公開側の読み取り」）。
 * 公開中だけを返すこと、並び順、前後のナビ、詳細ページを持たないものを返さないこと、言語の代替を確かめる
 */
import { env } from 'cloudflare:test'
import { isNotFound } from '@tanstack/react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadProjectDetail, loadWorkDetail } from '../../src/content/portfolio-detail'
import { loadBlogPost, loadCodingLog } from '../../src/content/post-detail'
import type { ContentContext } from '../../src/content/shared'
import { loadTopPage } from '../../src/content/top-page'
import { getDb } from '../../src/db/client'
import { blogPost, career, codingLog, profile, project, socialLink, stack, work, workStack } from '../../src/db/schema'

const db = getDb(env)
const SITE_URL = 'https://x.eastasian.dev'
const context: ContentContext = { db, siteUrl: SITE_URL }

beforeEach(async () => {
  await db.batch([
    db.delete(work),
    db.delete(project),
    db.delete(stack),
    db.delete(career),
    db.delete(blogPost),
    db.delete(codingLog),
    db.delete(socialLink),
    db.delete(profile),
  ])
})

const at = (iso: string) => new Date(iso)

async function expectNotFound(read: Promise<unknown>): Promise<void> {
  const error = await read.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(isNotFound(error)).toBe(true)
}

describe('loadTopPage', () => {
  it('中身が何もなければ、プロフィールなしと空の配列', async () => {
    const view = await loadTopPage(context, 'ja')
    expect(view.profile).toBeNull()
    expect([view.careers, view.projects, view.works, view.stacks, view.blogPosts, view.codingLogs]).toEqual([
      [],
      [],
      [],
      [],
      [],
      [],
    ])
    expect(view.meta).toEqual({
      title: 'eastasian',
      description: null,
      ogImageUrl: `${SITE_URL}/og/default-ja.png`,
      alternates: { ja: `${SITE_URL}/ja`, en: `${SITE_URL}/en` },
    })
  })

  it('下書きは返さない', async () => {
    await db.batch([
      db.insert(career).values({ titleJa: '下書き', startDate: '2024-01', status: 'draft' }),
      db.insert(project).values({ titleJa: '下書き', slug: 'p', startDate: '2024-01', sortOrder: 0, status: 'draft' }),
      db.insert(work).values({ titleJa: '下書き', slug: 'w', sortOrder: 0, status: 'draft' }),
      db.insert(blogPost).values({ titleJa: '下書き', bodyJa: '本文', slug: 'b', status: 'draft' }),
      db.insert(codingLog).values({ titleJa: '下書き', bodyJa: '本文', slug: 'c', status: 'draft' }),
    ])
    const view = await loadTopPage(context, 'ja')
    expect([view.careers, view.projects, view.works, view.blogPosts, view.codingLogs]).toEqual([[], [], [], [], []])
  })

  it('経歴は開始日の新しい順、作品・プロジェクトは表示順、ブログ・コーディング記録は公開日の新しい順', async () => {
    await db.batch([
      db.insert(career).values({ titleJa: '古い', startDate: '2018-04', status: 'published' }),
      db.insert(career).values({ titleJa: '新しい', startDate: '2024-04', status: 'published' }),
      db.insert(work).values({ titleJa: '二番', slug: 'two', sortOrder: 2, status: 'published' }),
      db.insert(work).values({ titleJa: '一番', slug: 'one', sortOrder: 1, status: 'published' }),
      db
        .insert(project)
        .values({ titleJa: '二番', slug: 'two', startDate: '2024-01', sortOrder: 5, status: 'published' }),
      db
        .insert(project)
        .values({ titleJa: '一番', slug: 'one', startDate: '2020-01', sortOrder: -1, status: 'published' }),
      db.insert(blogPost).values({
        titleJa: '古い',
        bodyJa: '本文',
        slug: 'old',
        status: 'published',
        publishedAt: at('2026-01-01T00:00:00Z'),
      }),
      db.insert(blogPost).values({
        titleJa: '新しい',
        bodyJa: '本文',
        slug: 'new',
        status: 'published',
        publishedAt: at('2026-09-01T00:00:00Z'),
      }),
      db.insert(codingLog).values({
        titleJa: '古い',
        bodyJa: '本文',
        slug: 'old',
        status: 'published',
        publishedAt: at('2026-01-01T00:00:00Z'),
      }),
      db.insert(codingLog).values({
        kind: 'memo',
        titleJa: '新しい',
        bodyJa: '本文',
        slug: 'new',
        status: 'published',
        publishedAt: at('2026-09-01T00:00:00Z'),
      }),
    ])
    const view = await loadTopPage(context, 'ja')
    expect(view.careers.map((c) => c.title.value)).toEqual(['新しい', '古い'])
    expect(view.works.map((w) => w.slug)).toEqual(['one', 'two'])
    expect(view.projects.map((p) => p.slug)).toEqual(['one', 'two'])
    expect(view.blogPosts.map((p) => p.slug)).toEqual(['new', 'old'])
    expect(view.blogPosts[0]?.publishedAt).toBe('2026-09-01T00:00:00.000Z')
    expect(view.codingLogs.map((l) => [l.slug, l.kind])).toEqual([
      ['new', 'memo'],
      ['old', 'learning_log'],
    ])
  })

  it('使用技術は「トップに表示する」だけを表示順で、カードの技術はその中身の中での並び順で', async () => {
    const react = crypto.randomUUID()
    const go = crypto.randomUUID()
    const perl = crypto.randomUUID()
    const workId = crypto.randomUUID()
    await db.batch([
      db.insert(stack).values({ id: react, key: 'react', displayName: 'React', sortOrder: 1 }),
      db.insert(stack).values({ id: go, key: 'go', displayName: 'Go', sortOrder: 0, iconUrl: '/media/go.svg' }),
      db.insert(stack).values({ id: perl, key: 'perl', displayName: 'Perl', sortOrder: 2, showOnTop: false }),
      db.insert(work).values({ id: workId, titleJa: '作品', slug: 'app', sortOrder: 0, status: 'published' }),
      db.insert(workStack).values({ workId, stackId: perl, sortOrder: 0 }),
      db.insert(workStack).values({ workId, stackId: react, sortOrder: 1 }),
    ])
    const view = await loadTopPage(context, 'ja')
    expect(view.stacks.map((s) => s.key)).toEqual(['go', 'react'])
    expect(view.stacks[0]).toEqual({ key: 'go', displayName: 'Go', iconUrl: '/media/go.svg', linkUrl: null })
    expect(view.works[0]?.stacks.map((s) => s.key)).toEqual(['perl', 'react'])
  })

  it('詳細本文の有無をカードに返す', async () => {
    await db.batch([
      db.insert(work).values({ titleJa: 'あり', slug: 'a', bodyEn: 'Body', sortOrder: 0, status: 'published' }),
      db.insert(work).values({ titleJa: 'なし', slug: 'b', sortOrder: 1, status: 'published' }),
    ])
    const view = await loadTopPage(context, 'ja')
    expect(view.works.map((w) => w.hasDetail)).toEqual([true, false])
  })

  it('表示中の言語で言語ありでない中身はもう片方の言語で出し、項目は項目単位で代替する', async () => {
    await db.batch([
      db.insert(career).values({
        titleEn: 'Intern',
        organizationJa: '会社',
        organizationEn: null,
        locationEn: 'Singapore',
        startDate: '2020-07',
        status: 'published',
      }),
      db.insert(work).values({
        titleJa: '作品',
        titleEn: 'Work',
        summaryJa: null,
        summaryEn: 'Summary',
        slug: 'app',
        sortOrder: 0,
        status: 'published',
      }),
    ])
    const view = await loadTopPage(context, 'ja')
    const [intern] = view.careers
    expect(intern?.availability).toEqual({ lang: 'en', fallback: true })
    expect(intern?.title).toEqual({ value: 'Intern', lang: 'en' })
    expect(intern?.organization).toEqual({ value: '会社', lang: 'ja' })
    expect(intern?.location).toEqual({ value: 'Singapore', lang: 'en' })
    const [app] = view.works
    expect(app?.availability).toEqual({ lang: 'ja', fallback: false })
    expect(app?.summary).toEqual({ value: 'Summary', lang: 'en' })
  })

  it('ブログはタイトルと本文の両方で言語を決め、本文から抜粋を作る', async () => {
    await db.insert(blogPost).values({
      titleJa: '日本語のタイトルだけ',
      titleEn: 'English title',
      bodyEn: '## Heading\n\nFirst paragraph.\n\n```ts\nconst hidden = 1\n```',
      slug: 'post',
      status: 'published',
      publishedAt: at('2026-09-01T00:00:00Z'),
    })
    const [post] = (await loadTopPage(context, 'ja')).blogPosts
    expect(post?.availability).toEqual({ lang: 'en', fallback: true })
    expect(post?.title).toEqual({ value: 'English title', lang: 'en' })
    expect(post?.excerpt).toEqual({ value: 'Heading First paragraph.', lang: 'en' })
  })

  it('プロフィールは項目単位の代替だけで出し、タイトルと説明に使う', async () => {
    await db.batch([
      db.insert(profile).values({ nameJa: '東', nameEn: null, headlineEn: 'Engineer', bioJa: '**自己紹介**' }),
      db.insert(socialLink).values({ service: 'github', url: 'https://github.com/a', sortOrder: 0 }),
    ])
    const view = await loadTopPage(context, 'en')
    expect(view.profile?.name).toEqual({ value: '東', lang: 'ja' })
    expect(view.profile?.headline).toEqual({ value: 'Engineer', lang: 'en' })
    expect(view.profile?.bio?.lang).toBe('ja')
    expect(view.profile?.bio?.html).toContain('<strong>自己紹介</strong>')
    expect(view.profile?.socialLinks).toEqual([{ service: 'github', url: 'https://github.com/a', label: null }])
    expect(view.meta.title).toBe('eastasian — 東')
    expect(view.meta.description).toBe('Engineer')
    expect(view.meta.ogImageUrl).toBe(`${SITE_URL}/og/default-en.png`)
  })
})

describe('loadWorkDetail', () => {
  async function seedWorks() {
    const ids = { first: crypto.randomUUID(), middle: crypto.randomUUID(), last: crypto.randomUUID() }
    const reactId = crypto.randomUUID()
    await db.batch([
      db.insert(stack).values({ id: reactId, key: 'react', displayName: 'React', sortOrder: 0 }),
      db.insert(work).values({
        id: ids.first,
        titleJa: '最初',
        titleEn: 'First',
        bodyJa: '本文',
        bodyEn: 'Body',
        slug: 'first',
        sortOrder: 0,
        status: 'published',
      }),
      // 詳細本文がない・下書きの作品は、前後のナビで飛ばす
      db.insert(work).values({ titleJa: '本文なし', slug: 'no-body', sortOrder: 1, status: 'published' }),
      db.insert(work).values({ titleJa: '下書き', bodyJa: '本文', slug: 'draft', sortOrder: 2, status: 'draft' }),
      db.insert(work).values({
        id: ids.middle,
        titleJa: '真ん中',
        titleEn: 'Middle',
        summaryJa: '概要',
        bodyJa: '## 見出し\n\n日本語だけの本文',
        thumbnailUrl: '/media/thumb.png',
        githubUrl: 'https://github.com/a/b',
        slug: 'middle',
        sortOrder: 3,
        status: 'published',
      }),
      db.insert(workStack).values({ workId: ids.middle, stackId: reactId, sortOrder: 0 }),
      db.insert(work).values({
        id: ids.last,
        titleEn: 'Last only in English',
        bodyEn: 'Body',
        slug: 'last',
        sortOrder: 4,
        status: 'published',
      }),
    ])
    return ids
  }

  it('詳細ページを持つ公開中の作品の中で、表示順の前後を返す', async () => {
    const ids = await seedWorks()
    const view = await loadWorkDetail(context, { lang: 'ja', slug: 'middle' })
    expect(view.id).toBe(ids.middle)
    expect(view.prev).toEqual({ slug: 'first', title: { value: '最初', lang: 'ja' } })
    expect(view.next).toEqual({ slug: 'last', title: { value: 'Last only in English', lang: 'en' } })

    const first = await loadWorkDetail(context, { lang: 'ja', slug: 'first' })
    expect(first.prev).toBeNull()
    expect(first.next?.slug).toBe('middle')
    const last = await loadWorkDetail(context, { lang: 'ja', slug: 'last' })
    expect(last.next).toBeNull()
    expect(last.prev?.slug).toBe('middle')
  })

  it('本文・使用技術・外部への入口・ページのメタ情報を返す', async () => {
    await seedWorks()
    const view = await loadWorkDetail(context, { lang: 'ja', slug: 'middle' })
    expect(view.body.lang).toBe('ja')
    expect(view.body.html).toContain('<h3>見出し</h3>')
    expect(view.stacks.map((s) => s.key)).toEqual(['react'])
    expect(view.githubUrl).toBe('https://github.com/a/b')
    expect(view.meta).toEqual({
      title: '真ん中 — eastasian',
      description: '概要',
      ogImageUrl: `${SITE_URL}/media/thumb.png`,
      alternates: { ja: `${SITE_URL}/ja/works/middle`, en: `${SITE_URL}/en/works/middle` },
    })
  })

  it('表示中の言語の詳細本文がなければ、もう片方の言語の本文を返す', async () => {
    await seedWorks()
    const view = await loadWorkDetail(context, { lang: 'en', slug: 'middle' })
    expect(view.title).toEqual({ value: 'Middle', lang: 'en' })
    expect(view.availability).toEqual({ lang: 'en', fallback: false })
    expect(view.body.lang).toBe('ja')
    // 説明の概要も、項目単位の代替でもう片方の言語の値を使う
    expect(view.meta.description).toBe('概要')
  })

  it('概要がどちらの言語にもなければ、説明は詳細本文の抜粋', async () => {
    await seedWorks()
    const view = await loadWorkDetail(context, { lang: 'ja', slug: 'first' })
    expect(view.meta.description).toBe('本文')
  })

  it('存在しない・非公開・詳細本文がない作品は notFound', async () => {
    await seedWorks()
    await expectNotFound(loadWorkDetail(context, { lang: 'ja', slug: 'no-such' }))
    await expectNotFound(loadWorkDetail(context, { lang: 'ja', slug: 'draft' }))
    await expectNotFound(loadWorkDetail(context, { lang: 'ja', slug: 'no-body' }))
  })
})

describe('loadProjectDetail', () => {
  it('期間と前後を返し、詳細本文がない・非公開のプロジェクトは notFound', async () => {
    await db.batch([
      db.insert(project).values({
        titleJa: '一',
        bodyJa: '本文',
        slug: 'one',
        startDate: '2023-04',
        endDate: '2024-03',
        sortOrder: 0,
        status: 'published',
      }),
      db
        .insert(project)
        .values({ titleJa: '本文なし', slug: 'plain', startDate: '2023-01', sortOrder: 1, status: 'published' }),
      db.insert(project).values({
        titleJa: '二',
        bodyEn: 'Body',
        slug: 'two',
        startDate: '2024-04',
        sortOrder: 2,
        status: 'published',
      }),
      db.insert(project).values({
        titleJa: '下書き',
        bodyJa: '本文',
        slug: 'draft',
        startDate: '2024-04',
        sortOrder: 3,
        status: 'draft',
      }),
    ])
    const one = await loadProjectDetail(context, { lang: 'ja', slug: 'one' })
    expect(one.period).toEqual({ start: '2023-04', end: '2024-03' })
    expect(one.prev).toBeNull()
    expect(one.next?.slug).toBe('two')
    expect(one.meta.alternates.en).toBe(`${SITE_URL}/en/projects/one`)

    const two = await loadProjectDetail(context, { lang: 'ja', slug: 'two' })
    expect(two.period.end).toBeNull()
    expect(two.body.lang).toBe('en')
    expect(two.next).toBeNull()

    await expectNotFound(loadProjectDetail(context, { lang: 'ja', slug: 'plain' }))
    await expectNotFound(loadProjectDetail(context, { lang: 'ja', slug: 'draft' }))
  })
})

describe('loadBlogPost', () => {
  async function seedPosts() {
    const ids = { newest: crypto.randomUUID(), middle: crypto.randomUUID(), oldest: crypto.randomUUID() }
    await db.batch([
      db.insert(blogPost).values({
        id: ids.newest,
        titleEn: 'Newest',
        bodyEn: 'English only',
        slug: 'newest',
        status: 'published',
        publishedAt: at('2026-09-03T00:00:00Z'),
      }),
      // 下書きは前後のナビで飛ばす
      db.insert(blogPost).values({ titleJa: '下書き', bodyJa: '本文', slug: 'draft', status: 'draft' }),
      db.insert(blogPost).values({
        id: ids.middle,
        titleJa: '真ん中',
        bodyJa: '## 見出し\n\n本文の最初の段落',
        thumbnailUrl: '/media/thumb.png',
        slug: 'middle',
        status: 'published',
        publishedAt: at('2026-09-02T00:00:00Z'),
        contentUpdatedAt: at('2026-09-10T00:00:00Z'),
      }),
      db.insert(blogPost).values({
        id: ids.oldest,
        titleJa: '最古',
        bodyJa: '本文',
        titleEn: 'Oldest',
        bodyEn: 'Body',
        slug: 'oldest',
        status: 'published',
        publishedAt: at('2026-09-01T00:00:00Z'),
        // 公開日より前の更新日（データ移行で入りうる）は出さない
        contentUpdatedAt: at('2026-08-01T00:00:00Z'),
      }),
    ])
    return ids
  }

  it('公開中の記事の中で、公開日の新しい・古い記事を返す', async () => {
    const ids = await seedPosts()
    const view = await loadBlogPost(context, { lang: 'ja', slug: 'middle' })
    expect(view.id).toBe(ids.middle)
    expect(view.newer).toEqual({ slug: 'newest', title: { value: 'Newest', lang: 'en' } })
    expect(view.older).toEqual({ slug: 'oldest', title: { value: '最古', lang: 'ja' } })
    expect((await loadBlogPost(context, { lang: 'ja', slug: 'newest' })).newer).toBeNull()
    expect((await loadBlogPost(context, { lang: 'ja', slug: 'oldest' })).older).toBeNull()
  })

  it('本文・公開日・更新日・ページのメタ情報を返す', async () => {
    await seedPosts()
    const view = await loadBlogPost(context, { lang: 'ja', slug: 'middle' })
    expect(view.body).toEqual({ html: expect.stringContaining('<h3>見出し</h3>'), lang: 'ja' })
    expect(view.publishedAt).toBe('2026-09-02T00:00:00.000Z')
    expect(view.contentUpdatedAt).toBe('2026-09-10T00:00:00.000Z')
    expect(view.thumbnailUrl).toBe('/media/thumb.png')
    expect(view.meta).toEqual({
      title: '真ん中 — eastasian',
      description: '見出し 本文の最初の段落',
      ogImageUrl: `${SITE_URL}/media/thumb.png`,
      alternates: { ja: `${SITE_URL}/ja/blog/middle`, en: `${SITE_URL}/en/blog/middle` },
    })
  })

  it('更新日が公開日より後でなければ出さない', async () => {
    await seedPosts()
    expect((await loadBlogPost(context, { lang: 'ja', slug: 'oldest' })).contentUpdatedAt).toBeNull()
    expect((await loadBlogPost(context, { lang: 'ja', slug: 'newest' })).contentUpdatedAt).toBeNull()
  })

  it('表示中の言語で言語ありでない記事は、もう片方の言語で出す', async () => {
    await seedPosts()
    const view = await loadBlogPost(context, { lang: 'ja', slug: 'newest' })
    expect(view.availability).toEqual({ lang: 'en', fallback: true })
    expect(view.title).toEqual({ value: 'Newest', lang: 'en' })
    expect(view.body.lang).toBe('en')
    expect(view.meta.ogImageUrl).toBe(`${SITE_URL}/og/default-ja.png`)
  })

  it('存在しない・非公開の記事は notFound', async () => {
    await seedPosts()
    await expectNotFound(loadBlogPost(context, { lang: 'ja', slug: 'draft' }))
    await expectNotFound(loadBlogPost(context, { lang: 'ja', slug: 'no-such' }))
  })
})

describe('loadCodingLog', () => {
  it('種類・参考リンクと前後を返し、非公開の記録は notFound', async () => {
    const id = crypto.randomUUID()
    await db.batch([
      db.insert(codingLog).values({
        id,
        kind: 'problem',
        titleJa: '問題',
        bodyJa: '```ts\nconst a = 1\n```',
        referenceUrl: 'https://atcoder.jp/contests/abc001',
        slug: 'problem',
        status: 'published',
        publishedAt: at('2026-09-02T00:00:00Z'),
      }),
      db.insert(codingLog).values({
        titleJa: '古い記録',
        bodyJa: '本文',
        slug: 'older',
        status: 'published',
        publishedAt: at('2026-09-01T00:00:00Z'),
      }),
      db.insert(codingLog).values({ titleJa: '下書き', bodyJa: '本文', slug: 'draft', status: 'draft' }),
    ])
    const view = await loadCodingLog(context, { lang: 'en', slug: 'problem' })
    expect(view.id).toBe(id)
    expect(view.kind).toBe('problem')
    expect(view.referenceUrl).toBe('https://atcoder.jp/contests/abc001')
    expect(view.availability).toEqual({ lang: 'ja', fallback: true })
    expect(view.newer).toBeNull()
    expect(view.older).toEqual({ slug: 'older', title: { value: '古い記録', lang: 'ja' } })
    expect(view.meta.alternates.en).toBe(`${SITE_URL}/en/coding/problem`)
    await expectNotFound(loadCodingLog(context, { lang: 'ja', slug: 'draft' }))
  })
})

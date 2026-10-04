/**
 * 公開側のヘッダーとフッターの中身（SDD 5.11 の getSiteChrome）。公開中だけを数え、使用技術は「トップに表示する」で数える
 */
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadSiteChrome } from '../../src/content/load-site-chrome'
import { getDb } from '../../src/db/client'
import { blogPost, career, codingLog, profile, project, socialLink, stack, work } from '../../src/db/schema'

const db = getDb(env)

beforeEach(async () => {
  await db.batch([
    db.delete(career),
    db.delete(project),
    db.delete(work),
    db.delete(stack),
    db.delete(blogPost),
    db.delete(codingLog),
    db.delete(socialLink),
    db.delete(profile),
  ])
})

const NOW = new Date()

describe('loadSiteChrome', () => {
  it('中身が何もなければ、セクションも SNS もない', async () => {
    expect(await loadSiteChrome(db)).toEqual({ sections: [], socialLinks: [] })
  })

  it('下書きだけのセクションは出さない', async () => {
    await db.batch([
      db.insert(career).values({ titleJa: '下書き', status: 'draft' }),
      db.insert(project).values({ titleJa: '下書き', sortOrder: 0, status: 'draft' }),
      db.insert(work).values({ titleJa: '下書き', sortOrder: 0, status: 'draft' }),
      db.insert(blogPost).values({ titleJa: '下書き', status: 'draft' }),
      db.insert(codingLog).values({ titleJa: '下書き', status: 'draft' }),
    ])
    expect((await loadSiteChrome(db)).sections).toEqual([])
  })

  it('公開中が1件以上のセクションを、トップと同じ並びで返す', async () => {
    await db.batch([
      db.insert(codingLog).values({
        titleJa: '記録',
        bodyJa: '本文',
        slug: 'log',
        publishedAt: NOW,
        status: 'published',
      }),
      db.insert(career).values({ titleJa: '経歴', startDate: '2024-04', status: 'published' }),
      db.insert(work).values({ titleJa: '作品', slug: 'app', sortOrder: 0, status: 'published' }),
      db.insert(stack).values({ key: 'react', displayName: 'React', sortOrder: 0, showOnTop: true }),
    ])
    expect((await loadSiteChrome(db)).sections).toEqual(['career', 'works', 'stack', 'coding'])
  })

  it('使用技術は「トップに表示する」の技術がなければ出さない', async () => {
    await db.insert(stack).values({ key: 'go', displayName: 'Go', sortOrder: 0, showOnTop: false })
    expect((await loadSiteChrome(db)).sections).toEqual([])
  })

  it('SNS リンクは表示順で返し、プロフィールがなければ空', async () => {
    await db.batch([
      db.insert(socialLink).values({ service: 'x', url: 'https://x.com/a', sortOrder: 1 }),
      db.insert(socialLink).values({ service: 'other', url: 'https://example.com', label: 'Site', sortOrder: 2 }),
      db.insert(socialLink).values({ service: 'github', url: 'https://github.com/a', sortOrder: 0 }),
    ])
    expect((await loadSiteChrome(db)).socialLinks).toEqual([])

    await db.insert(profile).values({ nameJa: '名前' })
    expect((await loadSiteChrome(db)).socialLinks).toEqual([
      { service: 'github', url: 'https://github.com/a', label: null },
      { service: 'x', url: 'https://x.com/a', label: null },
      { service: 'other', url: 'https://example.com', label: 'Site' },
    ])
  })
})

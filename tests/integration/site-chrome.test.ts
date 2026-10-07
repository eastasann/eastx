/**
 * 公開側のフッターの中身（SDD 5.11 の getSiteChrome）。プロフィールの SNS リンクだけを返す
 */
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadSiteChrome } from '../../src/content/load-site-chrome'
import { getDb } from '../../src/db/client'
import { profile, socialLink } from '../../src/db/schema'

const db = getDb(env)

beforeEach(async () => {
  await db.batch([db.delete(socialLink), db.delete(profile)])
})

describe('loadSiteChrome', () => {
  it('プロフィールがなければ SNS もない', async () => {
    expect(await loadSiteChrome(db)).toEqual({ socialLinks: [] })
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

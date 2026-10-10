import { env } from 'cloudflare:test'
import { drizzle } from 'drizzle-orm/d1'
import { describe, expect, it } from 'vitest'
import { buildSeed } from '../../scripts/seed/data'
import { insertSeed } from '../../scripts/seed/insert'
import * as schema from '../../src/db/schema'

// シードがスキーマの制約をすべて満たし、1文100パラメーターの上限（ADR-006）の内で D1 に入ることを確かめる

async function counts(): Promise<Record<string, number>> {
  const tables = ['profile', 'social_link', 'career', 'stack', 'work', 'work_stack', 'project', 'project_stack']
  const all = [...tables, 'blog_post', 'coding_log', 'privacy_page', 'admin_user']
  const rows = await env.DB.batch(all.map((t) => env.DB.prepare(`select count(*) as n from ${t}`)))
  return Object.fromEntries(all.map((t, i) => [t, (rows[i]?.results[0] as { n: number } | undefined)?.n ?? -1]))
}

describe('insertSeed', () => {
  const db = drizzle(env.DB, { schema })

  it('全件のシードが入り、入れ直しても件数が変わらない', async () => {
    const data = buildSeed({ empty: false })
    await insertSeed(db, data)
    await insertSeed(db, buildSeed({ empty: false }))
    expect(await counts()).toEqual({
      profile: 1,
      social_link: 4,
      career: 8,
      stack: 16,
      work: 12,
      work_stack: data.workStacks.length,
      project: 7,
      project_stack: data.projectStacks.length,
      blog_post: 13,
      coding_log: 12,
      privacy_page: 1,
      admin_user: 0,
    })
  })

  it('空のシードはブログ・コーディング記録を0件にし、管理者の行は消さない', async () => {
    await env.DB.prepare(
      'insert into admin_user (id, name, email, github_user_id, github_login, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(crypto.randomUUID(), 'admin', 'admin@example.com', '1', 'admin', Date.now(), Date.now())
      .run()

    await insertSeed(db, buildSeed({ empty: true }))
    const c = await counts()
    expect(c.blog_post).toBe(0)
    expect(c.coding_log).toBe(0)
    expect(c.work).toBe(12)
    expect(c.privacy_page).toBe(1)
    expect(c.admin_user).toBe(1)
  })
})

/**
 * Better Auth の hooks（SDD 5.2・ADR-009）: ADMIN_GITHUB_USER_ID の人だけを管理者として作り、セッションを渡す。
 * GitHub のログインの流れを通さず、hooks がかかる内部のアダプターを直接呼んで確かめる。
 */
import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { getAuth } from '../../src/auth/server'
import { getDb } from '../../src/db/client'
import { adminSession, adminUser } from '../../src/db/schema'

/** GitHub のログインから作られるときと同じ出どころ */
const GITHUB_SOURCE = { method: 'oauth', oauth: { providerId: 'github' } }

function userInput(githubUserId: string) {
  return {
    name: `user-${githubUserId}`,
    email: `${githubUserId}@users.noreply.github.com`,
    emailVerified: false,
    githubUserId,
    githubLogin: `user-${githubUserId}`,
  }
}

describe('Better Auth の hooks', () => {
  it('管理者でない GitHub ID のユーザーは作らない', async () => {
    const { internalAdapter } = await getAuth().$context
    const created = await internalAdapter.createUser(userInput('2000002'), GITHUB_SOURCE)
    expect(created).toBeNull()
    const rows = await getDb(env).select().from(adminUser).where(eq(adminUser.githubUserId, '2000002'))
    expect(rows).toEqual([])
  })

  it('ADMIN_GITHUB_USER_ID のユーザーは作り、セッションも作れる', async () => {
    const { internalAdapter } = await getAuth().$context
    const created = await internalAdapter.createUser(userInput(env.ADMIN_GITHUB_USER_ID), GITHUB_SOURCE)
    expect(created).toMatchObject({ githubUserId: env.ADMIN_GITHUB_USER_ID })
    const session = await internalAdapter.createSession(created?.id ?? '')
    expect(session).toMatchObject({ userId: created?.id })
  })

  it('管理者でないユーザーの行が残っていても（ID を変えた後など）、セッションは作らない', async () => {
    const now = new Date()
    const id = crypto.randomUUID()
    await getDb(env)
      .insert(adminUser)
      .values({ id, ...userInput('3000003'), createdAt: now, updatedAt: now })
    const { internalAdapter } = await getAuth().$context
    expect(await internalAdapter.createSession(id)).toBeNull()
    const rows = await getDb(env).select().from(adminSession).where(eq(adminSession.userId, id))
    expect(rows).toEqual([])
  })
})

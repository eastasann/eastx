/**
 * 結合テストのヘルパー。ローカルの D1 に管理者とセッションを作り、Better Auth と同じ方式で署名した
 * セッションの Cookie を返す（SDD 10章）。本番のコードにテスト用の入口は作らない。
 */

import { env } from 'cloudflare:test'
import { createORPCClient } from '@orpc/client'
import { SimpleCsrfProtectionLinkPlugin } from '@orpc/client/plugins'
import type { ContractRouterClient } from '@orpc/contract'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { eq } from 'drizzle-orm'
import { app } from '../../src/api/app'
import { type Contract, contract } from '../../src/api/contract'
import { getAuth } from '../../src/auth/server'
import { getDb } from '../../src/db/client'
import { adminSession, adminUser } from '../../src/db/schema'

export const BASE_URL = 'http://localhost'
export const API_URL = `${BASE_URL}/api/admin`
export const CSRF_HEADER = { 'x-csrf-token': 'orpc' } as const

/**
 * better-call（Better Auth が使う）の署名付き Cookie と同じ形: `{トークン}.{HMAC-SHA256 の base64}` を URL エンコードしたもの
 */
async function signCookieValue(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return encodeURIComponent(`${value}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`)
}

export interface TestSession {
  userId: string
  /** `Cookie` ヘッダーの値 */
  cookie: string
}

/**
 * セッションを作る。`admin: true` は ADMIN_GITHUB_USER_ID の管理者（同じ D1 の中では1人なので使い回す）、
 * `false` は管理者でない GitHub アカウント（SDD 7章の「管理者でないセッション」）。
 * `expiresAt` を過去にすると、期限切れのセッションになる
 */
export async function createSession(options: { admin: boolean; expiresAt?: Date }): Promise<TestSession> {
  const db = getDb(env)
  const now = new Date()
  const githubUserId = options.admin ? env.ADMIN_GITHUB_USER_ID : `9${Math.floor(Math.random() * 1e9)}`
  let user = await db.select({ id: adminUser.id }).from(adminUser).where(eq(adminUser.githubUserId, githubUserId)).get()
  if (!user) {
    const id = crypto.randomUUID()
    await db.insert(adminUser).values({
      id,
      name: `user-${githubUserId}`,
      email: `${githubUserId}@users.noreply.github.com`,
      githubUserId,
      githubLogin: `user-${githubUserId}`,
      createdAt: now,
      updatedAt: now,
    })
    user = { id }
  }
  const token = crypto.randomUUID().replaceAll('-', '')
  await db.insert(adminSession).values({
    id: crypto.randomUUID(),
    token,
    userId: user.id,
    expiresAt: options.expiresAt ?? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
  })
  const { authCookies } = await getAuth().$context
  return {
    userId: user.id,
    cookie: `${authCookies.sessionToken.name}=${await signCookieValue(token, env.BETTER_AUTH_SECRET)}`,
  }
}

export type AdminClient = ContractRouterClient<Contract>

/** `/{id}` を持つ手続きの入力（`detailed`。パスの ID と本文を分ける） */
export function byId(id: string): { params: { id: string } }
export function byId<T>(id: string, body: T): { params: { id: string }; body: T }
export function byId<T>(id: string, body?: T) {
  return body === undefined ? { params: { id } } : { params: { id }, body }
}

/** 型付きクライアント（管理画面と同じ OpenAPILink ＋ CSRF のヘッダー）。HTTP を通さず Elysia のアプリを直接呼ぶ */
export function createClient(cookie: string): AdminClient {
  const link = new OpenAPILink(contract, {
    url: API_URL,
    headers: { cookie },
    fetch: async (request) => app.fetch(request),
    plugins: [new SimpleCsrfProtectionLinkPlugin()],
  })
  return createORPCClient(link)
}

/** 生の HTTP で呼ぶ（ステータス・ヘッダー・エラーの本文を確かめるとき） */
export function call(path: string, init: RequestInit & { cookie?: string; csrf?: boolean } = {}): Promise<Response> {
  const { cookie, csrf = true, headers, ...rest } = init
  const merged = new Headers(headers)
  if (csrf) for (const [name, value] of Object.entries(CSRF_HEADER)) merged.set(name, value)
  if (cookie) merged.set('cookie', cookie)
  return Promise.resolve(app.fetch(new Request(`${API_URL}${path}`, { ...rest, headers: merged })))
}

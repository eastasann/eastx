/**
 * 認可マトリクス（SDD 7章）の照合。コントラクトから全手続きを列挙し、一律にかかることを確かめる（SDD 10章）。
 * 401・403 は CSRF のヘッダーを付けたリクエストでの結果（SDD 5.1）。
 */
import { isContractProcedure } from '@orpc/contract'
import { beforeAll, describe, expect, it } from 'vitest'
import { contract } from '../../src/api/contract'
import { call, createSession, type TestSession } from './helpers'

interface Endpoint {
  name: string
  method: string
  path: string
}

function listEndpoints(router: object, prefix: string[] = []): Endpoint[] {
  return Object.entries(router).flatMap(([key, value]) => {
    if (isContractProcedure(value)) {
      const { method = 'POST', path = '' } = value['~orpc'].route
      return [{ name: [...prefix, key].join('.'), method, path: path.replace('{id}', crypto.randomUUID()) }]
    }
    return listEndpoints(value as object, [...prefix, key])
  })
}

const endpoints = listEndpoints(contract)

/** 本文を持つ手続きには、形の正しくない本文を付ける（認証・認可が入力の検証より先に効くことも確かめる） */
function requestInit(endpoint: Endpoint): RequestInit {
  if (endpoint.method === 'GET' || endpoint.method === 'DELETE') return { method: endpoint.method }
  return { method: endpoint.method, body: '{}', headers: { 'content-type': 'application/json' } }
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { code: string }).code
}

describe('全手続きの認証・認可・CSRF', () => {
  let nonAdmin: TestSession
  let expired: TestSession
  let admin: TestSession

  beforeAll(async () => {
    nonAdmin = await createSession({ admin: false })
    expired = await createSession({ admin: true, expiresAt: new Date(Date.now() - 1000) })
    admin = await createSession({ admin: true })
  })

  it('SDD 5章の全手続きが列挙されている', () => {
    expect(endpoints.map((e) => `${e.method} ${e.path.replace(/[0-9a-f-]{36}/, '{id}')}`).sort()).toEqual(
      [
        'GET /dashboard',
        'GET /profile',
        'PUT /profile',
        ...['careers', 'works', 'projects', 'stacks', 'blog-posts', 'coding-logs'].flatMap((r) => [
          `GET /${r}`,
          `POST /${r}`,
          `GET /${r}/{id}`,
          `PUT /${r}/{id}`,
          `DELETE /${r}/{id}`,
        ]),
        'POST /works/reorder',
        'POST /projects/reorder',
        'POST /stacks/reorder',
        'GET /slugs/suggest',
        'GET /slugs/availability',
        'POST /uploads',
        'GET /privacy',
        'PUT /privacy',
        'GET /analytics',
        'GET /openapi.json',
      ].sort(),
    )
  })

  it.each(endpoints.map((e) => [e.name, e] as const))('%s: 未認証は 401', async (_, endpoint) => {
    const res = await call(endpoint.path, requestInit(endpoint))
    expect(res.status).toBe(401)
    expect(await errorCode(res)).toBe('UNAUTHORIZED')
  })

  it.each(endpoints.map((e) => [e.name, e] as const))('%s: 期限切れのセッションは 401', async (_, endpoint) => {
    const res = await call(endpoint.path, { ...requestInit(endpoint), cookie: expired.cookie })
    expect(res.status).toBe(401)
  })

  it.each(endpoints.map((e) => [e.name, e] as const))('%s: 管理者でないセッションは 403', async (_, endpoint) => {
    const res = await call(endpoint.path, { ...requestInit(endpoint), cookie: nonAdmin.cookie })
    expect(res.status).toBe(403)
    expect(await errorCode(res)).toBe('FORBIDDEN')
  })

  it.each(endpoints.map((e) => [e.name, e] as const))('%s: CSRF のヘッダーなしは 403', async (_, endpoint) => {
    const res = await call(endpoint.path, { ...requestInit(endpoint), csrf: false, cookie: admin.cookie })
    expect(res.status).toBe(403)
    expect(await errorCode(res)).toBe('CSRF_TOKEN_MISMATCH')
  })

  it('CSRF のヘッダーなしは、未認証でも 403', async () => {
    const res = await call('/dashboard', { csrf: false })
    expect(res.status).toBe(403)
    expect(await errorCode(res)).toBe('CSRF_TOKEN_MISMATCH')
  })

  it('署名の合わない Cookie は 401', async () => {
    const [name, value = ''] = admin.cookie.split('=')
    const tampered = `${name}=${value.replace(/.{4}$/, 'AAAA')}`
    const res = await call('/dashboard', { cookie: tampered })
    expect(res.status).toBe(401)
  })

  it('管理者のセッションは通る', async () => {
    const res = await call('/dashboard', { cookie: admin.cookie })
    expect(res.status).toBe(200)
  })
})

describe('レート制限（ADR-021）', () => {
  it('ユーザーごとに 60秒 300回を超えると 429（認可より前に数える）', async () => {
    const session = await createSession({ admin: false })
    for (let i = 0; i < 300; i++) {
      const res = await call('/dashboard', { cookie: session.cookie })
      expect(res.status).toBe(403)
    }
    const res = await call('/dashboard', { cookie: session.cookie })
    expect(res.status).toBe(429)
    expect(await errorCode(res)).toBe('TOO_MANY_REQUESTS')

    // 別のユーザーは数えられない
    const other = await createSession({ admin: false })
    expect((await call('/dashboard', { cookie: other.cookie })).status).toBe(403)
  })
})

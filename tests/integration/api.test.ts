import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { app } from '../../src/api/app'
import { handlerInterceptors } from '../../src/api/errors'
import { call, createSession } from './helpers'

// PNG のシグネチャ8バイト（配信のヘッダーの確認用。画像として完全である必要はない）
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const SVG_BODY = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'

describe('GET /api/admin/openapi.json', () => {
  let cookie: string

  beforeAll(async () => {
    ;({ cookie } = await createSession({ admin: true }))
  })

  it('管理者に OpenAPI 3.1 の仕様を返し、SDD 5章の全手続きが載る', async () => {
    const res = await call('/openapi.json', { cookie })
    expect(res.status).toBe(200)
    const spec = (await res.json()) as {
      openapi: string
      info: { title: string }
      servers: { url: string }[]
      paths: Record<string, Record<string, unknown>>
    }
    expect(spec.openapi).toMatch(/^3\.1/)
    expect(spec.info.title).toBe('eastx CMS API')
    expect(spec.servers).toEqual([{ url: '/api/admin' }])
    const operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
    )
    expect(operations).toHaveLength(40)
    expect(operations).toEqual(
      expect.arrayContaining(['POST /uploads', 'POST /works/reorder', 'GET /slugs/suggest', 'GET /openapi.json']),
    )
  })

  it('未認証は 401（openapi.json もほかの手続きと同じ）', async () => {
    expect((await call('/openapi.json')).status).toBe(401)
  })
})

describe('/api/admin/* の入口とエラーの形式（SDD 8章）', () => {
  let cookie: string

  beforeAll(async () => {
    ;({ cookie } = await createSession({ admin: true }))
  })

  it('すべてのレスポンスに x-request-id。cf-ray があればその値', async () => {
    const res = await call('/dashboard', { cookie, headers: { 'cf-ray': '8c1f2a0000000000-NRT' } })
    expect(res.headers.get('x-request-id')).toBe('8c1f2a0000000000-NRT')
    const error = await call('/dashboard')
    expect(error.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('未定義の手続きは oRPC のエラー形式で 404', async () => {
    const res = await call('/no-such', { method: 'POST', cookie })
    expect(res.status).toBe(404)
    expect(res.headers.get('x-request-id')).toBeTruthy()
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('NOT_FOUND')
  })

  it('/api・/media のほかのパスも、x-request-id 付きの 404', async () => {
    for (const path of ['/api', '/api/admin', '/api/no-such', '/media', '/api/admin/']) {
      const res = await app.fetch(new Request(`http://localhost${path}`, { method: 'POST', body: '{}' }))
      expect(res.status, path).toBe(404)
      expect(res.headers.get('x-request-id'), path).toBeTruthy()
      expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND')
    }
  })

  it('本文を JSON として解釈できなければ INPUT_VALIDATION_FAILED（formErrors）', async () => {
    const res = await call('/works', {
      method: 'POST',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: '{bad',
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      defined: true,
      code: 'INPUT_VALIDATION_FAILED',
      status: 422,
      message: '入力内容に誤りがあります',
      data: { fieldErrors: {}, formErrors: ['リクエストの形式が正しくありません'] },
    })
  })

  it('想定外の例外は INTERNAL_SERVER_ERROR。message は一般的な文言にし、data.requestId だけを返す', async () => {
    const [interceptor] = handlerInterceptors
    const context = {
      requestId: 'req-500',
      headers: new Headers(),
      trace: { route: 'GET /api/admin/dashboard', procedureStarted: true, detailedInput: false },
    }
    const failing = interceptor?.({
      context,
      request: { method: 'GET' },
      next: () => Promise.reject(new Error('D1_ERROR: secret detail')),
    } as never)
    await expect(failing).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      status: 500,
      defined: true,
      message: 'サーバーでエラーが発生しました',
      data: { requestId: 'req-500' },
    })
  })
})

describe('GET /media/{key}', () => {
  beforeAll(async () => {
    await env.MEDIA.put('uploads/2026/10/test.png', PNG_BYTES, {
      httpMetadata: { contentType: 'image/png' },
    })
    await env.MEDIA.put('uploads/2026/10/test.svg', SVG_BODY, {
      httpMetadata: { contentType: 'image/svg+xml' },
    })
  })

  it('R2 のオブジェクトを長期キャッシュのヘッダー付きで返す', async () => {
    const res = await app.fetch(new Request('http://localhost/media/uploads/2026/10/test.png'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/png')
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('ETag')).toBeTruthy()
    expect(res.headers.get('Content-Security-Policy')).toBeNull()
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES)
  })

  it('SVG には sandbox の CSP を付ける', async () => {
    const res = await app.fetch(new Request('http://localhost/media/uploads/2026/10/test.svg'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox")
  })

  it('If-None-Match が一致すれば 304 を返す', async () => {
    const first = await app.fetch(new Request('http://localhost/media/uploads/2026/10/test.png'))
    const etag = first.headers.get('ETag')
    expect(etag).toBeTruthy()
    const second = await app.fetch(
      new Request('http://localhost/media/uploads/2026/10/test.png', {
        headers: { 'If-None-Match': etag as string },
      }),
    )
    expect(second.status).toBe(304)
  })

  it('304 にも 200 と同じ防御ヘッダーを付ける（SVG の CSP・nosniff）', async () => {
    const first = await app.fetch(new Request('http://localhost/media/uploads/2026/10/test.svg'))
    const etag = first.headers.get('ETag') as string
    const second = await app.fetch(
      new Request('http://localhost/media/uploads/2026/10/test.svg', { headers: { 'If-None-Match': etag } }),
    )
    expect(second.status).toBe(304)
    expect(second.headers.get('ETag')).toBe(etag)
    expect(second.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(second.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(second.headers.get('Content-Security-Policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox")
  })

  it('x-request-id を付ける', async () => {
    const res = await app.fetch(new Request('http://localhost/media/uploads/2026/10/test.png'))
    expect(res.headers.get('x-request-id')).toBeTruthy()
  })

  it('ないキーは 404', async () => {
    const res = await app.fetch(new Request('http://localhost/media/uploads/no-such.png'))
    expect(res.status).toBe(404)
  })

  it('不正なパーセントエンコーディングも 404（500 にしない）', async () => {
    const res = await app.fetch(new Request('http://localhost/media/%zz'))
    expect(res.status).toBe(404)
  })

  it('R2 のキー上限（1024 バイト）を超えるキーも 404（500 にしない）', async () => {
    const res = await app.fetch(new Request(`http://localhost/media/${'a'.repeat(1100)}`))
    expect(res.status).toBe(404)
  })
})

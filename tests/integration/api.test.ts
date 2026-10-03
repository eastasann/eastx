import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { app } from '../../src/api/app'

// PNG のシグネチャ8バイト（配信のヘッダーの確認用。画像として完全である必要はない）
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const SVG_BODY = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'

describe('GET /api/admin/openapi.json', () => {
  it('OpenAPI 3.1 の仕様を返す', async () => {
    const res = await app.fetch(new Request('http://localhost/api/admin/openapi.json'))
    expect(res.status).toBe(200)
    const spec = (await res.json()) as { openapi: string; info: { title: string } }
    expect(spec.openapi).toMatch(/^3\.1/)
    expect(spec.info.title).toBe('eastx CMS API')
  })
})

describe('/api/admin/*（コントラクトは Step 3 で書く）', () => {
  it('未定義の手続きは oRPC のエラー形式で 404 を返す', async () => {
    const res = await app.fetch(new Request('http://localhost/api/admin/no-such', { method: 'POST' }))
    expect(res.status).toBe(404)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('NOT_FOUND')
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

  it('ないキーは 404', async () => {
    const res = await app.fetch(new Request('http://localhost/media/uploads/no-such.png'))
    expect(res.status).toBe(404)
  })

  it('不正なパーセントエンコーディングも 404（500 にしない）', async () => {
    const res = await app.fetch(new Request('http://localhost/media/%zz'))
    expect(res.status).toBe(404)
  })
})

/**
 * `GET /media/{key}`: R2 の画像の配信（SDD 5.10・ADR-010）。
 * まず Cache API を見て、なければ R2 から読み、長期キャッシュのヘッダーを付けて
 * Cache API に入れてから返す。キーは不変（UUID）なので immutable にできる。
 */
import { env } from 'cloudflare:workers'

const CACHE_CONTROL = 'public, max-age=31536000, immutable'
// SVG は直接開かれてもスクリプトを動かさない（SDD 5.10）
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox"

export async function serveMedia(request: Request): Promise<Response> {
  const url = new URL(request.url)
  let key: string
  try {
    key = decodeURIComponent(url.pathname).replace(/^\/media\//, '')
  } catch {
    // 不正なパーセントエンコーディング（/media/%zz など）は、存在しないキーと同じ 404 にする
    return new Response(null, { status: 404 })
  }
  if (key === '') return new Response(null, { status: 404 })

  // lib.dom の CacheStorage が Workers のランタイム型より優先されて default が見えないため読み替える
  // キャッシュキーからクエリを落とす。キーの中身は不変（UUID）なので、
  // クエリ違いで同じオブジェクトのエントリが増えたり、キャッシュを素通りされたりしない
  const cacheKey = `${url.origin}${url.pathname}`
  // lib.dom の CacheStorage が Workers のランタイム型より優先されて default が見えないため読み替える
  const cache = (caches as unknown as { default: Cache }).default
  let response = await cache.match(cacheKey)

  if (!response) {
    const object = await env.MEDIA.get(key)
    if (!object) return new Response(null, { status: 404 })

    const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream'
    const headers = new Headers({
      'Content-Type': contentType,
      'Cache-Control': CACHE_CONTROL,
      ETag: object.httpEtag,
      'X-Content-Type-Options': 'nosniff',
    })
    // パラメーター付き（image/svg+xml;charset=utf-8）で保存されても CSP が外れないよう、メディアタイプだけで比べる
    if ((contentType.split(';')[0] ?? '').trim() === 'image/svg+xml') {
      headers.set('Content-Security-Policy', SVG_CSP)
    }
    response = new Response(object.body, { headers })
    await cache.put(cacheKey, response.clone())
  }

  const etag = response.headers.get('ETag')
  if (etag !== null && request.headers.get('If-None-Match') === etag) {
    // 304 にも 200 と同じ防御ヘッダー（nosniff・SVG の CSP）を付け、中間キャッシュの実装差で
    // セキュリティヘッダーだけが落ちる余地を作らない。本文の記述ヘッダーだけを除く
    const headers = new Headers(response.headers)
    headers.delete('Content-Type')
    headers.delete('Content-Length')
    return new Response(null, { status: 304, headers })
  }
  return response
}

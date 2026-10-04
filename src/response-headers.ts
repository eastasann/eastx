/**
 * Worker が返すレスポンスに付けるヘッダー（SDD 7章「セキュリティヘッダー」・ADR-019）。
 * 静的アセットは Worker を通らないので、ここで付くのは HTML・サーバー関数・API・画像のレスポンスだけ
 */

export const NOINDEX = 'noindex, nofollow'

/**
 * ブラウザの Sentry が送る先の origin。DSN の host は組織とリージョンで変わる（`o123.ingest.us.sentry.io` など）ので、
 * 固定のワイルドカードではなく、設定した DSN から決める。空・読めない DSN なら送らない（Sentry の SDK も同じ扱い）
 */
function sentryOrigin(dsn: string): string | null {
  if (dsn === '') return null
  try {
    const url = new URL(dsn)
    return url.protocol === 'https:' ? url.origin : null
  } catch {
    return null
  }
}

export function contentSecurityPolicy(sentryDsn: string): string {
  const sentry = sentryOrigin(sentryDsn)
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    sentry === null ? "connect-src 'self'" : `connect-src 'self' ${sentry}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}

export function securityHeaders(sentryDsn: string): Record<string, string> {
  return {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': contentSecurityPolicy(sentryDsn),
  }
}

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/**
 * レスポンスにヘッダーを付けて返す。
 * - セキュリティヘッダーは HTML と API に付ける。`/media/*` は画像ごとのヘッダー（nosniff と SVG の sandbox の CSP。
 *   SDD 5.10）を src/api/media.ts が付けるので、ページの CSP で上書きしない
 * - `X-Robots-Tag` は `/admin/*`・`/api/*` と、staging のすべてに付ける
 */
export function withResponseHeaders(
  pathname: string,
  response: Response,
  env: { environment: string; sentryDsn: string },
): Response {
  // fetch・Cache API 由来のレスポンスはヘッダーを変えられないので作り直す
  const result = new Response(response.body, response)
  if (!isUnder(pathname, '/media')) {
    for (const [name, value] of Object.entries(securityHeaders(env.sentryDsn))) result.headers.set(name, value)
  }
  if (env.environment === 'staging' || isUnder(pathname, '/admin') || isUnder(pathname, '/api')) {
    result.headers.set('X-Robots-Tag', NOINDEX)
  }
  return result
}

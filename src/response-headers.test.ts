import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy, NOINDEX, securityHeaders, withResponseHeaders } from './response-headers'

const DSN = 'https://abc123@o4501.ingest.us.sentry.io/4502'
const PROD = { environment: 'production', sentryDsn: DSN }

function html(): Response {
  return new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } })
}

describe('contentSecurityPolicy', () => {
  it('SDD 7章の値で、connect-src は DSN の origin', () => {
    expect(contentSecurityPolicy(DSN)).toBe(
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: https:; connect-src 'self' https://o4501.ingest.us.sentry.io; frame-ancestors 'none'; " +
        "base-uri 'self'; form-action 'self'",
    )
  })

  it('DSN が空・読めない・https でなければ、connect-src は self だけ', () => {
    for (const dsn of ['', '<Sentry の DSN>', 'http://key@sentry.local/1']) {
      expect(contentSecurityPolicy(dsn), dsn).toContain("connect-src 'self';")
    }
  })
})

describe('withResponseHeaders', () => {
  it('HTML と API にセキュリティヘッダーを付ける', () => {
    for (const path of ['/ja', '/en/works/x', '/admin/works', '/api/admin/dashboard', '/robots.txt']) {
      const res = withResponseHeaders(path, html(), PROD)
      for (const [name, value] of Object.entries(securityHeaders(DSN))) expect(res.headers.get(name), path).toBe(value)
    }
    expect(withResponseHeaders('/ja', html(), PROD).headers.get('Strict-Transport-Security')).toBe(
      'max-age=31536000; includeSubDomains',
    )
    expect(withResponseHeaders('/ja', html(), PROD).headers.get('Referrer-Policy')).toBe(
      'strict-origin-when-cross-origin',
    )
  })

  it('/media/* の画像ごとの CSP（SVG の sandbox）を上書きしない', () => {
    const svg = new Response('<svg/>', {
      headers: { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" },
    })
    const res = withResponseHeaders('/media/uploads/a.svg', svg, PROD)
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox")
    expect(res.headers.get('Strict-Transport-Security')).toBeNull()
  })

  it('本番とローカルでは、/admin・/api にだけ X-Robots-Tag を付ける', () => {
    for (const environment of ['production', 'local']) {
      const env = { environment, sentryDsn: '' }
      for (const path of ['/admin', '/admin/login', '/api/admin/works', '/api/auth/get-session', '/api']) {
        expect(withResponseHeaders(path, html(), env).headers.get('X-Robots-Tag'), path).toBe(NOINDEX)
      }
      for (const path of ['/', '/ja', '/en/blog/x', '/media/uploads/a.png', '/robots.txt', '/administrator', '/apis']) {
        expect(withResponseHeaders(path, html(), env).headers.get('X-Robots-Tag'), path).toBeNull()
      }
    }
  })

  it('staging ではすべてのレスポンスに X-Robots-Tag を付ける', () => {
    const env = { environment: 'staging', sentryDsn: DSN }
    for (const path of ['/', '/ja', '/media/uploads/a.png', '/robots.txt', '/admin']) {
      expect(withResponseHeaders(path, html(), env).headers.get('X-Robots-Tag'), path).toBe(NOINDEX)
    }
  })

  it('状態コード・本文・元のヘッダーはそのまま', async () => {
    const original = new Response('moved', { status: 302, headers: { location: '/ja', 'x-request-id': 'r1' } })
    const res = withResponseHeaders('/', original, PROD)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/ja')
    expect(res.headers.get('x-request-id')).toBe('r1')
    expect(await res.text()).toBe('moved')
  })

  it('ヘッダーを変えられないレスポンスにも付けられる', () => {
    const immutable = Response.redirect('https://x.eastasian.dev/ja', 302)
    expect(() => immutable.headers.set('x', 'y')).toThrow()
    expect(withResponseHeaders('/', immutable, PROD).headers.get('X-Content-Type-Options')).toBe('nosniff')
  })
})

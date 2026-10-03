/**
 * `/api/auth/*` の振り分けとレート制限（SDD 5.2・ADR-021）。AUTH_RATE_LIMITER は IP ごとに 60秒 10回で、
 * 数えるのはログインの開始（POST /sign-in/*）と GitHub からの戻り（GET /callback/*）だけ。
 * レート制限の数はテストファイルの中で持ち越すので、テストごとに別の IP を使う。
 */
import { describe, expect, it } from 'vitest'
import { app } from '../../src/api/app'

const SITE = 'http://localhost:3000'
const LIMIT = 10

let ipSeq = 0
function nextIp(): string {
  ipSeq += 1
  return `203.0.113.${ipSeq}`
}

function authRequest(path: string, ip: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('cf-connecting-ip', ip)
  // Better Auth は POST の Origin を trustedOrigins（SITE_URL）と照らす
  headers.set('origin', SITE)
  return Promise.resolve(app.fetch(new Request(`${SITE}/api/auth${path}`, { ...init, headers })))
}

/** A1 が送るのと同じ形のログインの開始 */
function signIn(ip: string): Promise<Response> {
  return authRequest('/sign-in/social', ip, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'github',
      callbackURL: '/admin/works/0f8c',
      errorCallbackURL: '/admin/login?redirect=%2Fadmin%2Fworks%2F0f8c',
    }),
  })
}

describe('/api/auth/*', () => {
  it('ログインの開始は GitHub の認可画面の URL を返す', async () => {
    const res = await signIn(nextIp())
    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toBeTruthy()
    const body = (await res.json()) as { url: string; redirect: boolean }
    expect(body.redirect).toBe(true)
    const url = new URL(body.url)
    expect(`${url.origin}${url.pathname}`).toBe('https://github.com/login/oauth/authorize')
    expect(url.searchParams.get('redirect_uri')).toBe(`${SITE}/api/auth/callback/github`)
  })

  it('ログインの開始で渡した戻り先を読めない戻り（state の不一致・期限切れ）も A1 へ error を付けて戻す', async () => {
    const res = await authRequest('/callback/github?code=x&state=y', nextIp())
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toMatch(/^\/admin\/login\?error=/)
  })

  it('GitHub でキャンセルされた戻りは errorCallbackURL（redirect 付きの A1）へ access_denied を付けて戻す', async () => {
    const ip = nextIp()
    const started = await signIn(ip)
    const state = new URL(((await started.json()) as { url: string }).url).searchParams.get('state')
    // ログインの開始で付いた Cookie（state の照合に使う）を、ブラウザと同じく戻りに付ける
    const cookie = started.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    const res = await authRequest(`/callback/github?error=access_denied&state=${state}`, ip, { headers: { cookie } })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/admin/login?redirect=%2Fadmin%2Fworks%2F0f8c&error=access_denied')
  })

  it('セッションがなければ get-session は null', async () => {
    const res = await authRequest('/get-session', nextIp())
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })
})

describe('AUTH_RATE_LIMITER', () => {
  it('ログインの開始は 10回まで通し、11回目は 429', async () => {
    const ip = nextIp()
    for (let i = 0; i < LIMIT; i++) expect((await signIn(ip)).status).toBe(200)
    const res = await signIn(ip)
    expect(res.status).toBe(429)
    expect(res.headers.get('x-request-id')).toBeTruthy()
    expect(await res.json()).toMatchObject({ code: 'TOO_MANY_REQUESTS', status: 429 })
  })

  it('GitHub からの戻りも同じ数に入り、超えたら A1 へ戻す', async () => {
    const ip = nextIp()
    for (let i = 0; i < LIMIT; i++) {
      expect((await authRequest('/callback/github?code=x&state=y', ip)).status).toBe(302)
    }
    const res = await authRequest('/callback/github?code=x&state=y', ip)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/admin/login?error=too_many_requests')
    expect((await signIn(ip)).status).toBe(429)
  })

  it('get-session とログアウトは数えない', async () => {
    const ip = nextIp()
    for (let i = 0; i < LIMIT * 2; i++) {
      expect((await authRequest('/get-session', ip)).status).toBe(200)
      expect((await authRequest('/sign-out', ip, { method: 'POST' })).status).not.toBe(429)
    }
    expect((await signIn(ip)).status).toBe(200)
  })

  it('IP ごとに数える', async () => {
    const limited = nextIp()
    for (let i = 0; i <= LIMIT; i++) await signIn(limited)
    expect((await signIn(limited)).status).toBe(429)
    expect((await signIn(nextIp())).status).toBe(200)
  })
})

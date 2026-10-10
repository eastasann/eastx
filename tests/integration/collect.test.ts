/**
 * 解析の受け口 `POST /api/collect`（SDD 5.14）と日ごとの値（ADR-023）。
 * Analytics Engine のバインディングは vitest.config.ts がテストにだけ足し、書き込みは writeDataPoint の spy で確かめる。
 * COLLECT_RATE_LIMITER の数はテストファイルの中で持ち越すので、テストごとに別の IP を使う
 */
import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dailySalt, prepareSalt } from '../../src/api/analytics/salt'
import { app } from '../../src/api/app'
import { jstDateOf } from '../../src/domain/analytics/dates'
import { saltExpiration, saltKey } from '../../src/domain/analytics/visitor'
import { createSession } from './helpers'

const SITE = 'http://localhost:3000'
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const PAGE_VIEW = { type: 'page_view', path: '/ja', lang: 'ja', referrer: 'https://www.linkedin.com/feed/' }

let ipSeq = 0
function nextIp(): string {
  ipSeq += 1
  return `198.51.100.${ipSeq}`
}

function collect(
  body: unknown,
  options: { ip?: string; headers?: Record<string, string>; method?: string } = {},
): Promise<Response> {
  const headers = new Headers({
    'content-type': 'text/plain;charset=UTF-8',
    origin: SITE,
    'user-agent': BROWSER_UA,
    'accept-language': 'ja-JP,ja;q=0.9,en;q=0.8',
    'cf-connecting-ip': options.ip ?? nextIp(),
    ...options.headers,
  })
  const method = options.method ?? 'POST'
  const init: RequestInit = { method, headers }
  if (method !== 'GET' && method !== 'HEAD') init.body = typeof body === 'string' ? body : JSON.stringify(body)
  return Promise.resolve(app.fetch(new Request(`${SITE}/api/collect`, init)))
}

function spyWrites() {
  const dataset = env.ANALYTICS
  if (dataset === undefined) throw new Error('テストの設定に ANALYTICS が無い')
  return vi.spyOn(dataset, 'writeDataPoint')
}

/** バインディングを外して、staging・ローカル（バインディングが無い環境）にする。戻す関数を返す */
function withoutBinding(name: 'ANALYTICS' | 'ANALYTICS_SALTS'): () => void {
  const target = env as unknown as Record<string, unknown>
  const saved = target[name]
  Reflect.deleteProperty(target, name)
  return () => {
    target[name] = saved
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/collect', () => {
  it('正しい本文は 204 で、Analytics Engine に1件書く（SDD 5.14 の表の並び）', async () => {
    const writes = spyWrites()
    const res = await collect(PAGE_VIEW, { headers: { 'cf-ray': '9d0e1f0000000001-NRT' } })
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(res.headers.get('x-request-id')).toBe('9d0e1f0000000001-NRT')
    expect(writes).toHaveBeenCalledTimes(1)
    const point = writes.mock.calls[0]?.[0]
    const visitor = point?.indexes?.[0]
    expect(visitor).toMatch(/^[0-9a-f]{32}$/)
    expect(point?.blobs).toEqual([
      'page_view',
      '/ja',
      'ja',
      'www.linkedin.com',
      '',
      // ローカルの workerd は request.cf の国を持たない
      'XX',
      'desktop',
      'ja',
      '',
      '',
      '',
      '',
      '',
      visitor,
    ])
    expect(point?.doubles).toEqual([0])
  })

  it('同じ日・同じ IP と User-Agent は同じ訪問者。IPv6 は同じ /64 なら同じ訪問者', async () => {
    const writes = spyWrites()
    const ip = nextIp()
    await collect(PAGE_VIEW, { ip })
    await collect({ type: 'section_view', path: '/ja', lang: 'ja', section: 'career' }, { ip })
    await collect(PAGE_VIEW)
    await collect(PAGE_VIEW, { ip: '2001:db8:aa:bb::1' })
    await collect(PAGE_VIEW, { ip: '2001:db8:aa:bb:1234::99' })
    const visitors = writes.mock.calls.map((call) => call[0]?.indexes?.[0])
    expect(visitors[0]).toBe(visitors[1])
    expect(visitors[2]).not.toBe(visitors[0])
    expect(visitors[3]).toBe(visitors[4])
  })

  it('その日の値が KV に無ければ作り、日本時間の日の終わり＋10分の期限で置く', async () => {
    await collect(PAGE_VIEW)
    const today = jstDateOf(Date.now())
    const { keys } = (await env.ANALYTICS_SALTS?.list({ prefix: saltKey(today) })) ?? { keys: [] }
    expect(keys).toEqual([{ name: saltKey(today), expiration: saltExpiration(today) }])
  })

  it.each([
    ['DNT', { dnt: '1' }],
    ['GPC', { 'sec-gpc': '1' }],
    ['ボットの User-Agent', { 'user-agent': 'Mozilla/5.0 (compatible; SentryUptimeBot/1.0)' }],
    ['空の User-Agent', { 'user-agent': '' }],
  ])('%s は書かずに 204', async (_, headers) => {
    const writes = spyWrites()
    const res = await collect(PAGE_VIEW, { headers })
    expect(res.status).toBe(204)
    expect(writes).not.toHaveBeenCalled()
  })

  it('管理者のセッションを持つ送信は書かずに 204、管理者でないセッションは書く', async () => {
    const writes = spyWrites()
    const admin = await createSession({ admin: true })
    expect((await collect(PAGE_VIEW, { headers: { cookie: admin.cookie } })).status).toBe(204)
    expect(writes).not.toHaveBeenCalled()
    const other = await createSession({ admin: false })
    expect((await collect(PAGE_VIEW, { headers: { cookie: other.cookie } })).status).toBe(204)
    expect(writes).toHaveBeenCalledTimes(1)
  })

  it.each(['ANALYTICS', 'ANALYTICS_SALTS'] as const)(
    'バインディング %s が無い環境（staging・ローカル）は書かずに 204',
    async (name) => {
      const writes = spyWrites()
      const restore = withoutBinding(name)
      try {
        expect((await collect(PAGE_VIEW)).status).toBe(204)
      } finally {
        restore()
      }
      expect(writes).not.toHaveBeenCalled()
    },
  )

  it('書き込みの例外は 204 で返す（ブラウザはやり直さない）', async () => {
    spyWrites().mockImplementation(() => {
      throw new Error('Analytics Engine の内部の文面')
    })
    const res = await collect(PAGE_VIEW)
    expect(res.status).toBe(204)
  })

  it.each([
    ['JSON でない', 'not json'],
    ['余分なキー', { ...PAGE_VIEW, section: 'career' }],
    ['値の誤り', { ...PAGE_VIEW, lang: 'fr' }],
    ['4KB を超える', { ...PAGE_VIEW, referrer: `https://example.com/${'a'.repeat(5000)}` }],
    ['空の本文', ''],
  ])('%s は 400（8章の形）', async (_, body) => {
    const writes = spyWrites()
    const res = await collect(body)
    expect(res.status).toBe(400)
    expect(res.headers.get('x-request-id')).toBeTruthy()
    expect(await res.json()).toEqual({
      defined: false,
      code: 'INPUT_VALIDATION_FAILED',
      status: 400,
      message: '入力内容に誤りがあります',
    })
    expect(writes).not.toHaveBeenCalled()
  })

  it('違う Origin は 403、Origin の無い送信は受け付ける', async () => {
    const forbidden = await collect(PAGE_VIEW, { headers: { origin: 'https://evil.example' } })
    expect(forbidden.status).toBe(403)
    expect(await forbidden.json()).toMatchObject({ defined: false, code: 'FORBIDDEN', status: 403 })
    const headers = new Headers({ 'user-agent': BROWSER_UA, 'cf-connecting-ip': nextIp() })
    const res = await app.fetch(
      new Request(`${SITE}/api/collect`, { method: 'POST', headers, body: JSON.stringify(PAGE_VIEW) }),
    )
    expect(res.status).toBe(204)
  })

  it('POST 以外は 404', async () => {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const res = await collect(PAGE_VIEW, { method })
      expect(res.status, method).toBe(404)
    }
  })

  it('IP ごとに60秒120回まで。超えたら 429（8章の形）', async () => {
    const ip = nextIp()
    for (let i = 0; i < 120; i++) expect((await collect(PAGE_VIEW, { ip })).status).toBe(204)
    const res = await collect(PAGE_VIEW, { ip })
    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({ defined: false, code: 'TOO_MANY_REQUESTS', status: 429 })
    expect((await collect(PAGE_VIEW)).status).toBe(204)
  })
})

describe('日ごとの値（ADR-023）', () => {
  const failOnPut = (error: unknown) => {
    throw error
  }

  const kv = () => {
    const salts = env.ANALYTICS_SALTS
    if (salts === undefined) throw new Error('テストの設定に ANALYTICS_SALTS が無い')
    return salts
  }

  it('KV にあれば KV の値を使う', async () => {
    await kv().put(saltKey('2030-01-02'), 'b'.repeat(64))
    expect(await dailySalt(kv(), '2030-01-02', failOnPut)).toBe('b'.repeat(64))
  })

  it('同じ isolate の2回目は KV を読まず、5分経てば読み直す', async () => {
    const get = vi.spyOn(kv(), 'get')
    const now = Date.parse('2030-01-03T00:00:00Z')
    const salt = await dailySalt(kv(), '2030-01-03', failOnPut, now)
    expect(await dailySalt(kv(), '2030-01-03', failOnPut, now + 1000)).toBe(salt)
    expect(get).toHaveBeenCalledTimes(1)
    expect(await dailySalt(kv(), '2030-01-03', failOnPut, now + 5 * 60 * 1000)).toBe(salt)
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('KV に書けなくても、作った値で数え、書けなかったことを知らせる', async () => {
    vi.spyOn(kv(), 'put').mockRejectedValue(new Error('KV PUT failed: 429 Too Many Requests'))
    const errors: unknown[] = []
    const salt = await dailySalt(kv(), '2030-01-05', (error) => errors.push(error))
    expect(salt).toMatch(/^[0-9a-f]{64}$/)
    expect(errors).toHaveLength(1)
  })

  it('Cron は翌日の値を期限付きで作り、すでにあれば書き換えない', async () => {
    await prepareSalt(kv(), '2030-01-04')
    const first = await kv().get(saltKey('2030-01-04'))
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    const { keys } = await kv().list({ prefix: saltKey('2030-01-04') })
    expect(keys[0]?.expiration).toBe(saltExpiration('2030-01-04'))
    await prepareSalt(kv(), '2030-01-04')
    expect(await kv().get(saltKey('2030-01-04'))).toBe(first)
  })
})

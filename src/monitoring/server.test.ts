import { beforeEach, describe, expect, it, vi } from 'vitest'

const scope = vi.hoisted(() => ({ setTag: vi.fn() }))
const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  getIsolationScope: () => scope,
}))
vi.mock('@sentry/cloudflare', () => sentry)

const { captureServerError, reportServerErrors, requestIdOf, sentryOptions } = await import('./server')

function respond(status: number, headers: Record<string, string> = {}) {
  return async () => new Response(null, { status, headers })
}

beforeEach(() => {
  sentry.captureException.mockReset()
  sentry.captureMessage.mockReset()
  scope.setTag.mockReset()
})

describe('requestIdOf', () => {
  it('cf-ray があればその値', () => {
    expect(requestIdOf(new Request('https://x.eastasian.dev/', { headers: { 'cf-ray': 'ray-7' } }))).toBe('ray-7')
  })

  it('なければ UUID で、同じリクエストには同じ値を返す', () => {
    const request = new Request('http://localhost:3000/')
    const first = requestIdOf(request)
    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(requestIdOf(request)).toBe(first)
    expect(requestIdOf(new Request('http://localhost:3000/'))).not.toBe(first)
  })
})

describe('sentryOptions', () => {
  it('DSN が空なら送らない（dsn なし）', () => {
    expect(sentryOptions({ SENTRY_DSN: '', ENVIRONMENT: 'local' }).dsn).toBeUndefined()
  })

  it('環境名は ENVIRONMENT、トレースは本番 0.1・staging 1.0', () => {
    const dsn = 'https://key@o1.ingest.us.sentry.io/1'
    expect(sentryOptions({ SENTRY_DSN: dsn, ENVIRONMENT: 'production' })).toEqual({
      dsn,
      environment: 'production',
      tracesSampleRate: 0.1,
    })
    expect(sentryOptions({ SENTRY_DSN: dsn, ENVIRONMENT: 'staging' })).toEqual({
      dsn,
      environment: 'staging',
      tracesSampleRate: 1.0,
    })
  })
})

describe('reportServerErrors', () => {
  const request = new Request('https://x.eastasian.dev/ja/works/a', { headers: { 'cf-ray': 'ray-1' } })

  it('リクエストのスコープに request_id のタグを付ける（withSentry が自分で拾う例外にも付く）', async () => {
    await reportServerErrors(request, respond(200))
    expect(scope.setTag).toHaveBeenCalledWith('request_id', 'ray-1')
  })

  it('OPTIONS・HEAD は withSentry が包まず、スコープが共有なのでタグを付けない', async () => {
    for (const method of ['OPTIONS', 'HEAD']) {
      await reportServerErrors(new Request('https://x.eastasian.dev/ja', { method }), respond(200))
    }
    expect(scope.setTag).not.toHaveBeenCalled()
  })

  it('5xx でなければ何も送らない', async () => {
    for (const status of [200, 302, 404, 422, 429]) await reportServerErrors(request, respond(status))
    expect(sentry.captureMessage).not.toHaveBeenCalled()
    expect(sentry.captureException).not.toHaveBeenCalled()
  })

  it('例外を送っていない 5xx は、状態コードとパスを request_id のタグ付きで送る', async () => {
    const res = await reportServerErrors(request, respond(500))
    expect(res.status).toBe(500)
    expect(sentry.captureMessage).toHaveBeenCalledWith('500 GET /ja/works/a', {
      level: 'error',
      tags: { request_id: 'ray-1' },
    })
  })

  it('request_id はレスポンスの x-request-id を優先する', async () => {
    await reportServerErrors(request, respond(503, { 'x-request-id': 'req-9' }))
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tags: { request_id: 'req-9' } }),
    )
  })

  it('同じリクエストで例外を送っていれば、5xx を重ねて送らない', async () => {
    const error = new Error('D1 down')
    await reportServerErrors(request, async () => {
      await Promise.resolve()
      captureServerError(error, 'ray-1')
      return new Response(null, { status: 500 })
    })
    expect(sentry.captureException).toHaveBeenCalledWith(error, { tags: { request_id: 'ray-1' } })
    expect(sentry.captureMessage).not.toHaveBeenCalled()
  })

  it('別のリクエストで送った例外は、このリクエストの 5xx の報告を止めない', async () => {
    captureServerError(new Error('outside'), 'ray-0')
    await reportServerErrors(request, respond(500))
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1)
  })
})

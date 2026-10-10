/**
 * Cron の日ごとの集計（SDD ADR-023）。Analytics Engine の SQL API は fetch の spy で返す
 * （vitest-pool-workers 0.22.0 に fetchMock が無い。ADR-022 のスパイク）。
 * src/server.ts の scheduled は src/api/analytics/rollup.ts の runAnalyticsCron を呼ぶだけなので、それを直接呼ぶ
 */
import { env } from 'cloudflare:test'
import { asc } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rollUp, runAnalyticsCron } from '../../src/api/analytics/rollup'
import type { SqlApiConfig } from '../../src/api/analytics/sql'
import { getDb } from '../../src/db/client'
import { analyticsDaily, analyticsRollup } from '../../src/db/schema'
import { saltKey } from '../../src/domain/analytics/visitor'

const config: SqlApiConfig = { accountId: 'acc-1', token: 'token-1' }
/** 2026-10-11 00:15 JST（Cron の時刻） */
const NOW = Date.parse('2026-10-10T15:15:00Z')
const db = () => getDb(env)

/** 日本時間の日 → その日の 00:00 JST の UNIX 秒（SQL の toDateTime の引数） */
const dayStartSec = (date: string) => Date.parse(`${date}T00:00:00+09:00`) / 1000

interface FakeDay {
  pageViews: number
  visitors: number
  /** page の次元で返すパスの数（101 以上で (other) ができる） */
  pages?: number
}

/**
 * SQL API の偽物。問い合わせの期間の始まりから日を決め、`days` の値で応答を作る。数は本物と同じく文字列で返す。
 * `failing` の日の問い合わせは 500 を返す
 */
function fakeSqlApi(input: { days: Record<string, FakeDay>; oldest: string | null; failing?: string[] }) {
  const sent: { url: string; sql: string; auth: string | null }[] = []
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (resource, init) => {
    const request = new Request(resource, init)
    const sql = await request.text()
    sent.push({ url: request.url, sql, auth: request.headers.get('authorization') })
    if (sql.startsWith('SELECT COUNT() AS n, MIN(timestamp)')) {
      const data =
        input.oldest === null ? [{ n: '0', first: '1970-01-01 00:00:00' }] : [{ n: '42', first: input.oldest }]
      return Response.json({ meta: [], data, rows: data.length })
    }
    const start = Number(/timestamp >= toDateTime\((\d+)\)/.exec(sql)?.[1])
    const date = [...Object.keys(input.days), ...(input.failing ?? [])].find((d) => dayStartSec(d) === start)
    if (date !== undefined && input.failing?.includes(date)) return new Response('internal error', { status: 500 })
    const day = date === undefined ? undefined : input.days[date]
    if (day === undefined || day.pageViews === 0) {
      // 0件の日。合計の問い合わせ（GROUP BY なし）は0の1行、それ以外は行なし
      const data = sql.includes('GROUP BY') ? [] : [{ n: '0', v: '0' }]
      return Response.json({ meta: [], data, rows: data.length })
    }
    let data: Record<string, unknown>[] = []
    if (sql.includes("blob1 = 'page_view'") && !sql.includes('GROUP BY')) {
      data = [{ n: String(day.pageViews), v: String(day.visitors) }]
    } else if (sql.includes("blob1 = 'page_view'") && sql.includes('GROUP BY blob2')) {
      const pages = day.pages ?? 1
      data = Array.from({ length: pages }, (_, i) => ({ k0: `/ja/blog/p${i}`, n: pages - i, v: 1 }))
    } else if (sql.includes('GROUP BY blob8')) {
      // ブラウザの言語が無い送信
      data = [{ k0: '', n: '2', v: '1' }]
    } else if (sql.includes('GROUP BY blob11, blob12')) {
      data = [{ k0: 'github', k1: 'github.com', n: '3', v: '2' }]
    }
    return Response.json({ meta: [], data, rows: data.length })
  })
  return { spy, sent }
}

async function rolledUpDates(): Promise<string[]> {
  const rows = await db().select().from(analyticsRollup).orderBy(asc(analyticsRollup.date))
  return rows.map((row) => row.date)
}

async function dailyRows(date: string) {
  const rows = await db().select().from(analyticsDaily).orderBy(asc(analyticsDaily.dimension), asc(analyticsDaily.key))
  return rows.filter((row) => row.date === date)
}

beforeEach(async () => {
  await db().batch([db().delete(analyticsDaily), db().delete(analyticsRollup)])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('rollUp', () => {
  it('集計が空なら最も古いイベントの日から始め、昨日と一昨日を D1 に入れる', async () => {
    const { sent } = fakeSqlApi({
      days: { '2026-10-09': { pageViews: 10, visitors: 4 }, '2026-10-10': { pageViews: 7, visitors: 3 } },
      oldest: '2026-10-08 16:00:00',
    })
    const result = await rollUp({ db: db(), config, now: NOW, requestId: 'cron:test' })
    expect(result).toEqual({ rolledUp: ['2026-10-10', '2026-10-09'], failed: [] })
    expect(await rolledUpDates()).toEqual(['2026-10-09', '2026-10-10'])
    const rows = await dailyRows('2026-10-10')
    expect(rows).toEqual([
      { date: '2026-10-10', dimension: 'browser_lang', key: '(unknown)', count: 2, visitors: 1 },
      { date: '2026-10-10', dimension: 'outbound', key: 'github:github.com', count: 3, visitors: 2 },
      { date: '2026-10-10', dimension: 'page', key: '/ja/blog/p0', count: 1, visitors: 1 },
      { date: '2026-10-10', dimension: 'top_view', key: '', count: 7, visitors: 3 },
      { date: '2026-10-10', dimension: 'total', key: '', count: 7, visitors: 3 },
    ])
    // 問い合わせの形（認証のヘッダー、アカウントの URL、件数と訪問者数の数え方、日本時間の日の境目）
    const totalQuery = sent.find((s) => s.sql.includes(`toDateTime(${dayStartSec('2026-10-10')})`))
    expect(totalQuery?.url).toBe('https://api.cloudflare.com/client/v4/accounts/acc-1/analytics_engine/sql')
    expect(totalQuery?.auth).toBe('Bearer token-1')
    expect(totalQuery?.sql).toContain('SUM(_sample_interval) AS n, COUNT(DISTINCT blob14) AS v')
    expect(totalQuery?.sql).toContain(`timestamp < toDateTime(${dayStartSec('2026-10-11')})`)
  })

  it('同じ日をもう一度集計しても行は同じ（昨日・一昨日は毎回やり直す）', async () => {
    const days = { '2026-10-09': { pageViews: 10, visitors: 4 }, '2026-10-10': { pageViews: 7, visitors: 3 } }
    fakeSqlApi({ days, oldest: '2026-10-08 16:00:00' })
    await rollUp({ db: db(), config, now: NOW, requestId: 'cron:test' })
    const first = await dailyRows('2026-10-10')
    vi.restoreAllMocks()
    fakeSqlApi({ days, oldest: null })
    const result = await rollUp({ db: db(), config, now: NOW + 60_000, requestId: 'cron:test' })
    expect(result.rolledUp).toEqual(['2026-10-10', '2026-10-09'])
    expect(await dailyRows('2026-10-10')).toEqual(first)
    const rollup = await db().select().from(analyticsRollup)
    expect(rollup.every((row) => row.rolledUpAt.getTime() === NOW + 60_000)).toBe(true)
  })

  it('開始日より前の日は集計しない', async () => {
    fakeSqlApi({ days: { '2026-10-10': { pageViews: 1, visitors: 1 } }, oldest: '2026-10-10 03:00:00' })
    await rollUp({ db: db(), config, now: NOW, requestId: 'cron:test' })
    expect(await rolledUpDates()).toEqual(['2026-10-10'])
  })

  it('何も記録していなければ何もしない', async () => {
    fakeSqlApi({ days: {}, oldest: null })
    expect(await rollUp({ db: db(), config, now: NOW, requestId: 'cron:test' })).toEqual({ rolledUp: [], failed: [] })
    expect(await rolledUpDates()).toEqual([])
  })

  it('イベントが0件の日も analytics_rollup に入れる（集計した結果0件）', async () => {
    fakeSqlApi({ days: { '2026-10-10': { pageViews: 3, visitors: 1 } }, oldest: '2026-10-08 16:00:00' })
    await rollUp({ db: db(), config, now: NOW, requestId: 'cron:test' })
    expect(await rolledUpDates()).toEqual(['2026-10-09', '2026-10-10'])
    expect(await dailyRows('2026-10-09')).toEqual([])
  })

  it('上位100件を超えるキーは (other) にまとめる', async () => {
    fakeSqlApi({ days: { '2026-10-10': { pageViews: 200, visitors: 50, pages: 103 } }, oldest: '2026-10-09 16:00:00' })
    await rollUp({ db: db(), config, now: NOW, requestId: 'cron:test' })
    const pages = (await dailyRows('2026-10-10')).filter((row) => row.dimension === 'page')
    expect(pages).toHaveLength(101)
    expect(pages.find((row) => row.key === '(other)')).toMatchObject({ count: 3 + 2 + 1, visitors: 3 })
  })

  it('集計していない日が7日を超えるときは7日で止め、残りは次の実行で埋まる', async () => {
    await db()
      .insert(analyticsRollup)
      .values({ date: '2026-09-20', rolledUpAt: new Date(NOW) })
    fakeSqlApi({ days: {}, oldest: null })
    const first = await rollUp({ db: db(), config, now: NOW, requestId: 'cron:test' })
    expect(first.rolledUp).toEqual([
      '2026-10-10',
      '2026-10-09',
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
    ])
    const second = await rollUp({ db: db(), config, now: NOW, requestId: 'cron:test' })
    expect(second.rolledUp.slice(2)).toEqual(['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30'])
  })

  it('SQL API の失敗した日は analytics_rollup に入らず、ほかの日は入る', async () => {
    fakeSqlApi({
      days: { '2026-10-10': { pageViews: 3, visitors: 1 } },
      oldest: '2026-10-08 16:00:00',
      failing: ['2026-10-09'],
    })
    const result = await rollUp({ db: db(), config, now: NOW, requestId: 'cron:test' })
    expect(result).toEqual({ rolledUp: ['2026-10-10'], failed: ['2026-10-09'] })
    expect(await rolledUpDates()).toEqual(['2026-10-10'])
  })
  it('最初の日の集計が失敗して翌日が先に確定しても、次の実行で最初の日を埋める', async () => {
    const oldest = '2026-10-08 16:00:00'
    fakeSqlApi({ days: { '2026-10-10': { pageViews: 2, visitors: 1 } }, oldest, failing: ['2026-10-09'] })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await rollUp({ db: db(), config, now: NOW, requestId: 'cron:test' })).failed).toEqual(['2026-10-09'])
    vi.restoreAllMocks()
    // 3日後。昨日・一昨日の外に落ちた最初の日も、Analytics Engine の最も古いイベントの日から埋める
    fakeSqlApi({ days: { '2026-10-09': { pageViews: 1, visitors: 1 } }, oldest })
    const later = await rollUp({ db: db(), config, now: NOW + 3 * 24 * 60 * 60 * 1000, requestId: 'cron:test' })
    expect(later.rolledUp).toContain('2026-10-09')
    expect(await rolledUpDates()).toContain('2026-10-09')
  })

  it('応答の数・キーが読めない日は確定させない（0件として集計済みにしない）', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (resource, init) => {
      const sql = await new Request(resource, init).text()
      if (sql.startsWith('SELECT COUNT() AS n, MIN(timestamp)')) {
        return Response.json({ meta: [], data: [{ n: '1', first: '2026-10-09 16:00:00' }], rows: 1 })
      }
      // 列の名前が違う応答（count・visitors）
      return Response.json({ meta: [], data: [{ count: '3', visitors: '1' }], rows: 1 })
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await rollUp({ db: db(), config, now: NOW, requestId: 'cron:test' })
    expect(result).toEqual({ rolledUp: [], failed: ['2026-10-10'] })
    expect(await rolledUpDates()).toEqual([])
  })
})

describe('runAnalyticsCron', () => {
  it('集計のあとに明日の日ごとの値を KV に作る', async () => {
    fakeSqlApi({ days: { '2026-10-10': { pageViews: 1, visitors: 1 } }, oldest: '2026-10-09 16:00:00' })
    await runAnalyticsCron({ db: db(), config, salts: env.ANALYTICS_SALTS, now: NOW })
    expect(await rolledUpDates()).toEqual(['2026-10-10'])
    expect(await env.ANALYTICS_SALTS?.get(saltKey('2026-10-12'))).toMatch(/^[0-9a-f]{64}$/)
  })

  it('API トークンが無くても、集計の失敗を残して明日の値は作る', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const later = Date.parse('2026-10-20T15:15:00Z')
    await runAnalyticsCron({ db: db(), config: null, salts: env.ANALYTICS_SALTS, now: later })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(errors.mock.calls.some(([line]) => String(line).includes('ANALYTICS_API_TOKEN'))).toBe(true)
    expect(await env.ANALYTICS_SALTS?.get(saltKey('2026-10-22'))).toMatch(/^[0-9a-f]{64}$/)
  })

  it('集計の全体が失敗しても（最も古いイベントが読めない）明日の値は作る', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unauthorized', { status: 401 }))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const later = Date.parse('2026-10-25T15:15:00Z')
    await runAnalyticsCron({ db: db(), config, salts: env.ANALYTICS_SALTS, now: later })
    expect(await rolledUpDates()).toEqual([])
    expect(await env.ANALYTICS_SALTS?.get(saltKey('2026-10-27'))).toMatch(/^[0-9a-f]{64}$/)
  })
})

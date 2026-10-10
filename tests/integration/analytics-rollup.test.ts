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
import { eventRow, pageViewRows, type SqlApiRow } from './sql-api'

const config: SqlApiConfig = { accountId: 'acc-1', token: 'token-1' }
/** 2026-10-11 00:15 JST（Cron の時刻） */
const NOW = Date.parse('2026-10-10T15:15:00Z')
const db = () => getDb(env)

/** 日本時間の日 → その日の 00:00 JST の UNIX 秒（SQL の toDateTime の引数） */
const dayStartSec = (date: string) => Date.parse(`${date}T00:00:00+09:00`) / 1000

/**
 * SQL API の偽物。問い合わせの期間の始まりから日を決め、`days` のその日の組を返す（無い日は0件）。
 * `failing` の日の問い合わせは 500 を返す
 */
function fakeSqlApi(input: { days: Record<string, SqlApiRow[]>; oldest: string | null; failing?: string[] }) {
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
    if (input.failing?.some((date) => dayStartSec(date) === start)) {
      return new Response('internal error', { status: 500 })
    }
    const date = Object.keys(input.days).find((d) => dayStartSec(d) === start)
    const data = date === undefined ? [] : (input.days[date] ?? [])
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
      days: { '2026-10-09': pageViewRows(10, 4), '2026-10-10': pageViewRows(7, 3) },
      oldest: '2026-10-08 16:00:00',
    })
    const result = await rollUp({ db: db(), config, now: NOW, requestId: 'cron:test' })
    expect(result).toEqual({ rolledUp: ['2026-10-10', '2026-10-09'], failed: [] })
    expect(await rolledUpDates()).toEqual(['2026-10-09', '2026-10-10'])
    expect((await dailyRows('2026-10-10')).filter((row) => row.dimension === 'total')).toEqual([
      { date: '2026-10-10', dimension: 'total', key: '', count: 7, visitors: 3 },
    ])
    // 1日ぶんは1本（最も古いイベントの1本と、2日の2本）。認証のヘッダー、アカウントの URL、日本時間の日の境目
    expect(sent).toHaveLength(3)
    const dayQuery = sent.find((s) => s.sql.includes(`toDateTime(${dayStartSec('2026-10-10')})`))
    expect(dayQuery?.url).toBe('https://api.cloudflare.com/client/v4/accounts/acc-1/analytics_engine/sql')
    expect(dayQuery?.auth).toBe('Bearer token-1')
    const blobs =
      'blob1, blob2, blob3, blob4, blob5, blob6, blob7, blob8, blob9, blob10, blob11, blob12, blob13, blob14'
    expect(dayQuery?.sql).toBe(
      `SELECT ${blobs}, SUM(_sample_interval) AS n FROM eastx_analytics` +
        ` WHERE timestamp >= toDateTime(${dayStartSec('2026-10-10')}) AND timestamp < toDateTime(${dayStartSec('2026-10-11')})` +
        ` GROUP BY ${blobs} FORMAT JSON`,
    )
  })

  it('組の行から次元ごとに数える（件数は組の合計、訪問者数はキーごとのハッシュの種類）', async () => {
    fakeSqlApi({
      days: {
        '2026-10-10': [
          eventRow({ type: 'page_view', visitor: 'v1', n: 2, referrer: 'www.linkedin.com' }),
          // 流入元の無い閲覧は referrer に数えない。P1 でない閲覧は top_view に数えない
          eventRow({ type: 'page_view', visitor: 'v1', path: '/ja/works/my-app' }),
          // ブラウザの言語が無い送信は (unknown)
          eventRow({ type: 'page_view', visitor: 'v2', referrer: 'www.linkedin.com', browserLang: '' }),
          eventRow({
            type: 'page_view',
            visitor: 'v3',
            path: '/en',
            lang: 'en',
            utm: 'linkedin|social|',
            country: 'US',
            device: 'mobile',
            browserLang: 'en',
          }),
          eventRow({ type: 'outbound', visitor: 'v1', n: 2, linkKind: 'github', host: 'github.com' }),
          eventRow({ type: 'outbound', visitor: 'v2', linkKind: 'github', host: 'github.com' }),
          eventRow({ type: 'row_expand', visitor: 'v1', section: 'works', itemId: 'id-1' }),
          eventRow({ type: 'section_view', visitor: 'v1', section: 'career' }),
          eventRow({ type: 'section_view', visitor: 'v2', section: 'career' }),
          eventRow({ type: 'paging', visitor: 'v1', section: 'blog' }),
          eventRow({ type: 'read_complete', visitor: 'v1', path: '/ja/works/my-app' }),
          eventRow({ type: 'lang_switch', visitor: 'v2', to: 'en' }),
          eventRow({ type: 'theme_switch', visitor: 'v3', path: '/en', lang: 'en', to: 'dark' }),
          eventRow({ type: 'code_copy', visitor: 'v1', path: '/ja/blog/hello' }),
        ],
      },
      oldest: '2026-10-09 16:00:00',
    })
    await rollUp({ db: db(), config, now: NOW, requestId: 'cron:test' })
    const row = (dimension: string, key: string, count: number, visitors: number) => ({
      date: '2026-10-10',
      dimension,
      key,
      count,
      visitors,
    })
    expect(await dailyRows('2026-10-10')).toEqual([
      row('browser_lang', '(unknown)', 1, 1),
      row('browser_lang', 'en', 1, 1),
      row('browser_lang', 'ja', 3, 1),
      row('code_copy', '/ja/blog/hello', 1, 1),
      row('country', 'JP', 4, 2),
      row('country', 'US', 1, 1),
      row('device', 'desktop', 4, 2),
      row('device', 'mobile', 1, 1),
      row('lang_switch', 'en', 1, 1),
      row('outbound', 'github:github.com', 3, 2),
      row('outbound_total', '', 3, 2),
      row('page', '/en', 1, 1),
      row('page', '/ja', 3, 2),
      row('page', '/ja/works/my-app', 1, 1),
      row('paging', 'blog', 1, 1),
      row('read_complete', '/ja/works/my-app', 1, 1),
      row('referrer', 'www.linkedin.com', 3, 2),
      row('row_expand', 'works:id-1', 1, 1),
      row('section_view', 'career', 2, 2),
      row('site_lang', 'en', 1, 1),
      row('site_lang', 'ja', 4, 2),
      row('theme_switch', 'dark', 1, 1),
      row('top_view', '', 4, 3),
      row('total', '', 5, 3),
      row('utm', 'linkedin|social|', 1, 1),
    ])
  })

  it('同じ日をもう一度集計しても行は同じ（昨日・一昨日は毎回やり直す）', async () => {
    const days = { '2026-10-09': pageViewRows(10, 4), '2026-10-10': pageViewRows(7, 3) }
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
    fakeSqlApi({ days: { '2026-10-10': pageViewRows(1, 1) }, oldest: '2026-10-10 03:00:00' })
    await rollUp({ db: db(), config, now: NOW, requestId: 'cron:test' })
    expect(await rolledUpDates()).toEqual(['2026-10-10'])
  })

  it('何も記録していなければ何もしない', async () => {
    fakeSqlApi({ days: {}, oldest: null })
    expect(await rollUp({ db: db(), config, now: NOW, requestId: 'cron:test' })).toEqual({ rolledUp: [], failed: [] })
    expect(await rolledUpDates()).toEqual([])
  })

  it('イベントが0件の日も analytics_rollup に入れる（集計した結果0件）', async () => {
    fakeSqlApi({ days: { '2026-10-10': pageViewRows(3, 1) }, oldest: '2026-10-08 16:00:00' })
    await rollUp({ db: db(), config, now: NOW, requestId: 'cron:test' })
    expect(await rolledUpDates()).toEqual(['2026-10-09', '2026-10-10'])
    expect(await dailyRows('2026-10-09')).toEqual([])
  })

  it('上位100件を超えるキーは (other) にまとめる', async () => {
    // 103のパスを1人ずつ。件数は 103, 102, …, 1
    const rows = Array.from({ length: 103 }, (_, i) =>
      eventRow({ type: 'page_view', visitor: `v${i}`, path: `/ja/blog/p${i}`, n: 103 - i }),
    )
    fakeSqlApi({ days: { '2026-10-10': rows }, oldest: '2026-10-09 16:00:00' })
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
      days: { '2026-10-10': pageViewRows(3, 1) },
      oldest: '2026-10-08 16:00:00',
      failing: ['2026-10-09'],
    })
    const result = await rollUp({ db: db(), config, now: NOW, requestId: 'cron:test' })
    expect(result).toEqual({ rolledUp: ['2026-10-10'], failed: ['2026-10-09'] })
    expect(await rolledUpDates()).toEqual(['2026-10-10'])
  })
  it('最初の日の集計が失敗して翌日が先に確定しても、次の実行で最初の日を埋める', async () => {
    const oldest = '2026-10-08 16:00:00'
    fakeSqlApi({ days: { '2026-10-10': pageViewRows(2, 1) }, oldest, failing: ['2026-10-09'] })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await rollUp({ db: db(), config, now: NOW, requestId: 'cron:test' })).failed).toEqual(['2026-10-09'])
    vi.restoreAllMocks()
    // 3日後。昨日・一昨日の外に落ちた最初の日も、Analytics Engine の最も古いイベントの日から埋める
    fakeSqlApi({ days: { '2026-10-09': pageViewRows(1, 1) }, oldest })
    const later = await rollUp({ db: db(), config, now: NOW + 3 * 24 * 60 * 60 * 1000, requestId: 'cron:test' })
    expect(later.rolledUp).toContain('2026-10-09')
    expect(await rolledUpDates()).toContain('2026-10-09')
  })

  it.each([
    ['列の名前が違う（count・visitors）', { count: '3', visitors: '1' }],
    ['blob が欠けている', { ...eventRow({ type: 'page_view', visitor: 'v1' }), blob14: undefined }],
    ['件数が数でない', { ...eventRow({ type: 'page_view', visitor: 'v1' }), n: 'many' }],
    ['件数が空白', { ...eventRow({ type: 'page_view', visitor: 'v1' }), n: ' ' }],
  ])('応答が読めない日は確定させない（0件として集計済みにしない）: %s', async (_, body) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (resource, init) => {
      const sql = await new Request(resource, init).text()
      if (sql.startsWith('SELECT COUNT() AS n, MIN(timestamp)')) {
        return Response.json({ meta: [], data: [{ n: '1', first: '2026-10-09 16:00:00' }], rows: 1 })
      }
      return Response.json({ meta: [], data: [body], rows: 1 })
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await rollUp({ db: db(), config, now: NOW, requestId: 'cron:test' })
    expect(result).toEqual({ rolledUp: [], failed: ['2026-10-10'] })
    expect(await rolledUpDates()).toEqual([])
  })
})

describe('runAnalyticsCron', () => {
  it('集計のあとに明日の日ごとの値を KV に作る', async () => {
    fakeSqlApi({ days: { '2026-10-10': pageViewRows(1, 1) }, oldest: '2026-10-09 16:00:00' })
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

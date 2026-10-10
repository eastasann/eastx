/**
 * A10 のアクセス解析（SDD 5.13）と A2 の要約（5.4）。認証・認可・CSRF の一律の確認は api-auth.test.ts にある。
 * 日付は実行した日（日本時間）からの相対で入れる。今日の分の SQL API は fetch の spy で返す
 */
import { env } from 'cloudflare:test'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '../../src/db/client'
import { analyticsDaily, analyticsRollup, blogPost, work } from '../../src/db/schema'
import { addDays, jstDateOf } from '../../src/domain/analytics/dates'
import { chunk } from '../../src/domain/analytics/rollup'
import { type AdminClient, call, createClient, createSession } from './helpers'
import { pageViewRows } from './sql-api'

let client: AdminClient
let cookie: string
const db = () => getDb(env)
const today = () => jstDateOf(Date.now())
const daysAgo = (n: number) => addDays(today(), -n)

type Dimension = (typeof analyticsDaily.$inferInsert)['dimension']
type Row = { dimension: Dimension; key?: string; count: number; visitors: number }

/** その日を集計済みにして、行を入れる */
async function rollUpDay(date: string, rows: Row[]) {
  await db().insert(analyticsRollup).values({ date, rolledUpAt: new Date() })
  // 1文のパラメーターの上限（100個。ADR-006）に収める
  for (const part of chunk(rows, 20)) {
    await db()
      .insert(analyticsDaily)
      .values(part.map((row) => ({ key: '', ...row, date })))
  }
}

/** env の値を一時的に変える。戻す関数を返す */
function setEnv(values: Record<string, unknown>): () => void {
  const target = env as unknown as Record<string, unknown>
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, target[key]]))
  Object.assign(target, values)
  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) Reflect.deleteProperty(target, key)
      else target[key] = value
    }
  }
}

/** 今日の分の SQL API。P1 の閲覧を `pageViews` 件、`visitors` 人で返す */
function fakeToday(pageViews: number, visitors: number) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    const data = pageViewRows(pageViews, visitors)
    return Response.json({ meta: [], data, rows: data.length })
  })
}

beforeAll(async () => {
  ;({ cookie } = await createSession({ admin: true }))
  client = createClient(cookie)
})

beforeEach(async () => {
  await db().batch([
    db().delete(analyticsDaily),
    db().delete(analyticsRollup),
    db().delete(work),
    db().delete(blogPost),
  ])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/admin/analytics', () => {
  it('range が5つ以外は 422', async () => {
    const res = await call('/analytics?range=2d', { cookie })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: 'INPUT_VALIDATION_FAILED' })
    expect((await call('/analytics', { cookie })).status).toBe(422)
  })

  it('期間・合計・前の期間・日ごとの推移を D1 の集計から返す', async () => {
    for (let i = 1; i <= 14; i++) {
      await rollUpDay(daysAgo(i), [
        { dimension: 'total', count: i, visitors: 1 },
        { dimension: 'outbound_total', count: 1, visitors: 1 },
      ])
    }
    const report = await client.analytics.get({ range: '7d' })
    expect(report).toMatchObject({
      measuring: true,
      range: '7d',
      from: daysAgo(6),
      to: today(),
      today: { included: false },
      missingDays: 0,
      // 今日は Cron がまだ集計しておらず、トークンも無いので昨日までの6日（1〜6日前）
      totals: {
        pageViews: 1 + 2 + 3 + 4 + 5 + 6,
        visitors: 6,
        outbound: 6,
        previous: { pageViews: 7 + 8 + 9 + 10 + 11 + 12 + 13, visitors: 7, outbound: 7 },
      },
      series: { bucket: 'day' },
    })
    expect(report.series.points).toHaveLength(7)
    expect(report.series.points[0]).toEqual({ start: daysAgo(6), pageViews: 6, visitors: 1 })
    expect(report.series.points[6]).toEqual({ start: today(), pageViews: 0, visitors: 0 })
  })

  it('前の期間は、開始日より前に始まるとき・all のとき null', async () => {
    await rollUpDay(daysAgo(13), [])
    await rollUpDay(daysAgo(10), [{ dimension: 'total', count: 1, visitors: 1 }])
    expect((await client.analytics.get({ range: '7d' })).totals.previous).toEqual({
      pageViews: 1,
      visitors: 1,
      outbound: 0,
    })
    expect((await client.analytics.get({ range: '30d' })).totals.previous).toBeNull()
    const all = await client.analytics.get({ range: 'all' })
    expect(all).toMatchObject({ from: daysAgo(13), series: { bucket: 'month' }, totals: { previous: null } })
    expect(all.series.points[0]?.start).toBe(daysAgo(13))
  })

  it('集計していない日の数は、開始日から昨日までで数える', async () => {
    await rollUpDay(daysAgo(5), [])
    await rollUpDay(daysAgo(3), [])
    await rollUpDay(daysAgo(1), [])
    const report = await client.analytics.get({ range: '7d' })
    expect(report.missingDays).toBe(2)
    await db().delete(analyticsRollup)
    expect((await client.analytics.get({ range: '7d' })).missingDays).toBe(0)
  })

  it('1y は月曜始まりの週で区切る', async () => {
    const report = await client.analytics.get({ range: '1y' })
    expect(report.series.bucket).toBe('week')
    expect(report.series.points[0]?.start).toBe(daysAgo(364))
    for (const point of report.series.points.slice(1)) expect(new Date(`${point.start}T00:00:00Z`).getUTCDay()).toBe(1)
  })

  it('一覧は期間で合計して上位10件。(other) は除き、タイトルを今の中身から引く（消したものは null）', async () => {
    const [mine] = await db()
      .insert(work)
      .values({ slug: 'my-app', titleJa: 'マイアプリ', titleEn: 'My App', sortOrder: 0 })
      .returning({ id: work.id })
    await db().insert(blogPost).values({ slug: 'hello', titleJa: 'こんにちは', bodyJa: '本文' })
    const pages: Row[] = Array.from({ length: 11 }, (_, i) => ({
      dimension: 'page',
      key: `/ja/blog/p${i}`,
      count: 1,
      visitors: 1,
    }))
    await rollUpDay(daysAgo(1), [
      ...pages,
      { dimension: 'page', key: '/ja/works/my-app', count: 5, visitors: 4 },
      { dimension: 'page', key: '/ja', count: 9, visitors: 6 },
      { dimension: 'page', key: '(other)', count: 99, visitors: 50 },
      { dimension: 'read_complete', key: '/en/blog/hello', count: 2, visitors: 2 },
      { dimension: 'read_complete', key: '/ja/works/renamed', count: 1, visitors: 1 },
      { dimension: 'row_expand', key: `works:${mine?.id}`, count: 3, visitors: 2 },
      { dimension: 'row_expand', key: 'career:3f1c0b2a-0000-4000-8000-000000000000', count: 1, visitors: 1 },
      { dimension: 'outbound', key: 'github:github.com', count: 4, visitors: 3 },
      { dimension: 'referrer', key: 'www.linkedin.com', count: 2, visitors: 2 },
      { dimension: 'utm', key: 'linkedin|social|', count: 1, visitors: 1 },
    ])
    await rollUpDay(daysAgo(2), [{ dimension: 'page', key: '/ja/works/my-app', count: 5, visitors: 3 }])

    const report = await client.analytics.get({ range: '7d' })
    expect(report.pages).toHaveLength(10)
    expect(report.pages.slice(0, 2)).toEqual([
      { path: '/ja/works/my-app', title: { ja: 'マイアプリ', en: 'My App' }, pageViews: 10, visitors: 7 },
      { path: '/ja', title: null, pageViews: 9, visitors: 6 },
    ])
    expect(report.pages.some((page) => page.path === '(other)')).toBe(false)
    expect(report.readCompletes).toEqual([
      { path: '/en/blog/hello', title: { ja: 'こんにちは', en: null }, count: 2, visitors: 2 },
      { path: '/ja/works/renamed', title: null, count: 1, visitors: 1 },
    ])
    expect(report.rowExpands).toEqual([
      { section: 'works', itemId: mine?.id, title: { ja: 'マイアプリ', en: 'My App' }, count: 3, visitors: 2 },
      { section: 'career', itemId: '3f1c0b2a-0000-4000-8000-000000000000', title: null, count: 1, visitors: 1 },
    ])
    expect(report.outbounds).toEqual([{ linkKind: 'github', host: 'github.com', count: 4, visitors: 3 }])
    expect(report.referrers).toEqual([{ key: 'www.linkedin.com', count: 2, visitors: 2 }])
    expect(report.utm).toEqual([{ key: 'linkedin|social|', count: 1, visitors: 1 }])
  })

  it('セクション到達率・その他の操作・属性', async () => {
    await rollUpDay(daysAgo(1), [
      { dimension: 'top_view', count: 12, visitors: 10 },
      { dimension: 'section_view', key: 'profile', count: 10, visitors: 10 },
      { dimension: 'section_view', key: 'career', count: 8, visitors: 7 },
      { dimension: 'lang_switch', key: 'en', count: 3, visitors: 2 },
      { dimension: 'theme_switch', key: 'dark', count: 2, visitors: 2 },
      { dimension: 'code_copy', key: '/ja/coding/x', count: 4, visitors: 3 },
      { dimension: 'paging', key: 'works', count: 5, visitors: 2 },
      { dimension: 'country', key: 'JP', count: 9, visitors: 8 },
      { dimension: 'device', key: 'mobile', count: 6, visitors: 5 },
      { dimension: 'browser_lang', key: '(unknown)', count: 1, visitors: 1 },
      { dimension: 'site_lang', key: 'ja', count: 10, visitors: 9 },
    ])
    const report = await client.analytics.get({ range: '30d' })
    expect(report.sectionReach).toEqual([
      { section: 'profile', visitors: 10, rate: 1 },
      { section: 'career', visitors: 7, rate: 0.7 },
      { section: 'projects', visitors: 0, rate: 0 },
      { section: 'works', visitors: 0, rate: 0 },
      { section: 'stack', visitors: 0, rate: 0 },
      { section: 'blog', visitors: 0, rate: 0 },
      { section: 'coding', visitors: 0, rate: 0 },
    ])
    expect(report.otherActions).toEqual({
      langSwitch: { ja: 0, en: 3 },
      themeSwitch: { system: 0, light: 0, dark: 2 },
      codeCopy: 4,
      paging: { career: 0, projects: 0, works: 5, blog: 0, coding: 0 },
    })
    expect(report.audience).toEqual({
      countries: [{ key: 'JP', count: 9, visitors: 8 }],
      devices: [{ key: 'mobile', count: 6, visitors: 5 }],
      browserLangs: [{ key: '(unknown)', count: 1, visitors: 1 }],
      siteLangs: [{ key: 'ja', count: 10, visitors: 9 }],
    })
  })

  it('P1 の閲覧が0なら到達率は null', async () => {
    const report = await client.analytics.get({ range: '7d' })
    expect(report.sectionReach.every((row) => row.rate === null)).toBe(true)
  })

  describe('今日の分', () => {
    it('トークンとアカウント ID があれば SQL API から読んで足す', async () => {
      const restore = setEnv({ CF_ACCOUNT_ID: 'acc-1', ANALYTICS_API_TOKEN: 'token-1' })
      try {
        await rollUpDay(daysAgo(1), [{ dimension: 'total', count: 2, visitors: 1 }])
        const fetchSpy = fakeToday(5, 3)
        const report = await client.analytics.get({ range: '7d' })
        expect(report.today).toEqual({ included: true })
        expect(report.totals).toMatchObject({ pageViews: 7, visitors: 4 })
        expect(report.series.points.at(-1)).toEqual({ start: today(), pageViews: 5, visitors: 3 })
        expect(report.pages).toEqual([{ path: '/ja', title: null, pageViews: 5, visitors: 3 }])
        // 今日の分は1本で読む（Worker が応答を待つ接続は同時に6本まで。SDD 5.13）
        expect(fetchSpy).toHaveBeenCalledTimes(1)
      } finally {
        restore()
      }
    })

    it.each([
      ['未登録', { CF_ACCOUNT_ID: undefined, ANALYTICS_API_TOKEN: undefined }],
      ['空文字のトークン', { CF_ACCOUNT_ID: 'acc-1', ANALYTICS_API_TOKEN: '' }],
      ['空文字のアカウント ID', { CF_ACCOUNT_ID: '', ANALYTICS_API_TOKEN: 'token-1' }],
    ])('%s なら SQL API を呼ばずに included: false', async (_, values) => {
      const restore = setEnv(values)
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      try {
        expect((await client.analytics.get({ range: '7d' })).today).toEqual({ included: false })
        expect(fetchSpy).not.toHaveBeenCalled()
      } finally {
        restore()
      }
    })

    it('SQL API が失敗したら included: false（エラーにしない）', async () => {
      const restore = setEnv({ CF_ACCOUNT_ID: 'acc-1', ANALYTICS_API_TOKEN: 'token-1' })
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('error', { status: 500 }))
      try {
        expect((await client.analytics.get({ range: '7d' })).today).toEqual({ included: false })
      } finally {
        restore()
      }
    })

    it('SQL API が3秒で応答しなければ included: false', async () => {
      const restore = setEnv({ CF_ACCOUNT_ID: 'acc-1', ANALYTICS_API_TOKEN: 'token-1' })
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        (_, init) =>
          new Promise((_, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
          }),
      )
      try {
        const started = Date.now()
        expect((await client.analytics.get({ range: '7d' })).today).toEqual({ included: false })
        expect(Date.now() - started).toBeGreaterThanOrEqual(2900)
      } finally {
        restore()
      }
    }, 10_000)
  })

  it('バインディングが無い環境では measuring: false', async () => {
    const restore = setEnv({ ANALYTICS: undefined })
    try {
      expect((await client.analytics.get({ range: '7d' })).measuring).toBe(false)
    } finally {
      restore()
    }
  })
})

describe('GET /api/admin/dashboard の analytics', () => {
  it('昨日までの7日の D1 の集計の合計。今日と8日前は含めず、SQL API は呼ばない', async () => {
    const restore = setEnv({ CF_ACCOUNT_ID: 'acc-1', ANALYTICS_API_TOKEN: 'token-1' })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      await rollUpDay(daysAgo(8), [{ dimension: 'total', count: 100, visitors: 50 }])
      await rollUpDay(daysAgo(7), [{ dimension: 'total', count: 3, visitors: 2 }])
      await rollUpDay(daysAgo(1), [{ dimension: 'total', count: 4, visitors: 3 }])
      await db()
        .insert(analyticsDaily)
        .values({ date: today(), dimension: 'total', key: '', count: 1000, visitors: 1000 })
      const { analytics } = await client.dashboard.get()
      expect(analytics).toEqual({ measuring: true, pageViews: 7, visitors: 5 })
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('バインディングが無い環境では measuring: false', async () => {
    const restore = setEnv({ ANALYTICS_SALTS: undefined })
    try {
      expect((await client.dashboard.get()).analytics).toEqual({ measuring: false, pageViews: 0, visitors: 0 })
    } finally {
      restore()
    }
  })
})

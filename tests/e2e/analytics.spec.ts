/**
 * アクセス解析（SDD ADR-023・5.13・5.14、design-spec 6.5・6.8）。
 * 公開側: ローカルは ANALYTICS_BEACON=on なので、どの操作でどのイベントが受け口へ送られるかを実際の経路で確かめる
 * （ローカルは Analytics Engine のバインディングが無いので、受け口は書かずに 204 を返す）。Playwright の Chromium は
 * navigator.webdriver が true で送信の部品が送らないので、初期化のスクリプトで false にする。
 * 管理画面: make e2e のデモデータ（make db-seed。前日までの400日、3日前が抜けている）で、A10・A2 の表示が API の応答と一致する
 */
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { gotoHydrated } from './hydration'

type Sent = Record<string, unknown>

/**
 * 受け口への送信を集める。sendBeacon の要求は Playwright から本文が読めない（ping の postData は null）ので、
 * ブラウザの sendBeacon を包んで本文を受け取り、要求そのものは元の sendBeacon で送る。応答の状態は受け口の応答から集める
 */
async function collect(page: Page) {
  const sent: Sent[] = []
  const statuses: number[] = []
  await page.exposeFunction('__recordBeacon', (json: string) => {
    sent.push(JSON.parse(json) as Sent)
  })
  await page.addInitScript(() => {
    const original = Navigator.prototype.sendBeacon
    Navigator.prototype.sendBeacon = function (url, data) {
      if (String(url).endsWith('/api/collect') && data instanceof Blob) {
        void data
          .text()
          .then((json) => (window as unknown as { __recordBeacon: (json: string) => void }).__recordBeacon(json))
      }
      return original.call(this, url, data)
    }
  })
  page.on('response', (response) => {
    const request = response.request()
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/collect')
      statuses.push(response.status())
  })
  return { sent, statuses }
}

/** 送信を有効にし、別タブで開くリンクは開かない（外部へ移らずに click だけを起こす） */
async function enableBeacon(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false })
    window.addEventListener(
      'click',
      (event) => {
        if (event.target instanceof Element && event.target.closest('a[target="_blank"]')) event.preventDefault()
      },
      true,
    )
  })
}

test.describe('公開側の送信', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('P1 から詳細へ移るまでの表示と行動を送る', async ({ page, context }) => {
    await enableBeacon(page)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const { sent, statuses } = await collect(page)

    await page.goto('/ja?utm_source=LinkedIn&utm_medium=social', { referer: 'https://www.linkedin.com/feed/' })
    await expect
      .poll(() => sent.find((event) => event.type === 'page_view'))
      .toEqual({
        type: 'page_view',
        referrer: 'https://www.linkedin.com/feed/',
        utm: { source: 'LinkedIn', medium: 'social', campaign: null },
        path: '/ja',
        lang: 'ja',
      })
    await gotoHydrated(page, '/ja')

    // スクロールで各セクションの見出しが画面に入る
    for (const id of ['career', 'projects', 'works', 'stack', 'blog', 'coding']) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded()
    }
    await expect
      .poll(() => sent.filter((event) => event.type === 'section_view').map((event) => event.section))
      .toEqual(expect.arrayContaining(['profile', 'career', 'projects', 'works', 'stack', 'blog', 'coding']))

    // 作品のページング（公開11件で2ページ）
    const works = page.locator('#works')
    await works.getByRole('button', { name: /次/ }).click()
    await expect.poll(() => sent.find((event) => event.type === 'paging')).toMatchObject({ section: 'works', page: 2 })
    await works.getByRole('button', { name: /前/ }).click()

    // 行を広げる（閉じたときは送らない）。先頭の作品は GitHub と詳細ページを持つ
    const row = works.locator('ul:not([inert])').getByRole('button', { expanded: false }).first()
    await row.click()
    await expect
      .poll(() => sent.find((event) => event.type === 'row_expand'))
      .toMatchObject({ section: 'works', path: '/ja', lang: 'ja' })
    await works.getByRole('button', { expanded: true }).click()
    await works.locator('ul:not([inert])').getByRole('button', { expanded: false }).first().click()
    await expect.poll(() => sent.filter((event) => event.type === 'row_expand').length).toBe(2)

    // 広げた中の GitHub（別タブのリンク）
    await works.getByRole('link', { name: /GitHub/ }).click()
    await expect
      .poll(() => sent.find((event) => event.type === 'outbound'))
      .toEqual({ type: 'outbound', linkKind: 'github', host: 'github.com', path: '/ja', lang: 'ja' })

    // 詳細へ移る。ルーターの移動の page_view は参照元を付けない
    await works.getByRole('link', { name: /詳細を見る/ }).click()
    await expect(page).toHaveURL(/\/ja\/works\//)
    const detailPath = new URL(page.url()).pathname
    await expect
      .poll(() => sent.filter((event) => event.type === 'page_view').at(-1))
      .toEqual({ type: 'page_view', path: detailPath, lang: 'ja' })

    // 本文の最後まで送る
    await page.keyboard.press('End')
    await expect
      .poll(() => sent.find((event) => event.type === 'read_complete'))
      .toEqual({
        type: 'read_complete',
        path: detailPath,
        lang: 'ja',
      })

    // テーマと言語の切り替え。切り替えた先の page_view は表示している言語で送る
    await page.getByRole('button', { name: /テーマ/ }).click()
    await expect.poll(() => sent.find((event) => event.type === 'theme_switch')).toMatchObject({ type: 'theme_switch' })
    await page.keyboard.press('Home')
    await page.getByRole('group', { name: /言語/ }).getByRole('link', { name: 'EN' }).click()
    await expect(page).toHaveURL(new RegExp(`/en${detailPath.slice(3)}$`))
    await expect
      .poll(() => sent.find((event) => event.type === 'lang_switch'))
      .toEqual({ type: 'lang_switch', to: 'en', path: detailPath, lang: 'ja' })
    await expect
      .poll(() => sent.filter((event) => event.type === 'page_view').at(-1))
      .toEqual({ type: 'page_view', path: `/en${detailPath.slice(3)}`, lang: 'en' })

    expect(statuses.length).toBeGreaterThan(0)
    expect(statuses.every((status) => status === 204)).toBe(true)
  })

  test('前後のナビで次の詳細へ移ると、前のページの本文の最後を次のページの読了として送らない', async ({ page }) => {
    // 本文の最後が最初の画面に入らない高さ
    await page.setViewportSize({ width: 1280, height: 500 })
    await enableBeacon(page)
    const { sent } = await collect(page)
    await gotoHydrated(page, '/ja/works/portfolio-cms')
    await page.keyboard.press('End')
    await expect
      .poll(() => sent.filter((event) => event.type === 'read_complete').map((event) => event.path))
      .toEqual(['/ja/works/portfolio-cms'])

    // 前後のナビは本文の最後のすぐ下にあり、押したときは前のページの印が画面に入っている
    await page.locator('a[rel="next"]').click()
    await expect(page).toHaveURL(/\/ja\/works\/task-board$/)
    await expect
      .poll(() => sent.filter((event) => event.type === 'page_view').at(-1))
      .toEqual({ type: 'page_view', path: '/ja/works/task-board', lang: 'ja' })
    await page.waitForTimeout(700)
    expect(sent.filter((event) => event.path === '/ja/works/task-board' && event.type === 'read_complete')).toEqual([])

    await page.keyboard.press('End')
    await expect
      .poll(() => sent.filter((event) => event.type === 'read_complete').map((event) => event.path))
      .toEqual(['/ja/works/portfolio-cms', '/ja/works/task-board'])
  })

  test('本文のコードブロックの「コピー」', async ({ page, context }) => {
    await enableBeacon(page)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const { sent } = await collect(page)
    await gotoHydrated(page, '/ja/coding/learn-elysia')
    await page.getByRole('button', { name: 'コピー' }).first().click()
    await expect
      .poll(() => sent.find((event) => event.type === 'code_copy'))
      .toEqual({ type: 'code_copy', path: '/ja/coding/learn-elysia', lang: 'ja' })
  })

  test('$lang の下の C1 は送り、受け口は 204 を返す', async ({ page }) => {
    await enableBeacon(page)
    const { sent, statuses } = await collect(page)
    await page.goto('/ja/works/none')
    await expect.poll(() => sent.find((event) => event.path === '/ja/works/none')).toMatchObject({ type: 'page_view' })
    await page.goto('/fr/foo')
    await expect.poll(() => sent.find((event) => event.path === '/fr/foo')).toMatchObject({ type: 'page_view' })
    await expect.poll(() => statuses.length).toBeGreaterThanOrEqual(2)
    expect(statuses.every((status) => status === 204)).toBe(true)
  })

  test('自動操作のブラウザ（navigator.webdriver）からは送らない', async ({ page }) => {
    const { sent } = await collect(page)
    await gotoHydrated(page, '/ja')
    await page.locator('#coding').scrollIntoViewIfNeeded()
    await page.waitForTimeout(500)
    expect(sent).toEqual([])
  })

  test('DNT のブラウザからは送らない', async ({ page }) => {
    await enableBeacon(page)
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '1' })
    })
    const { sent } = await collect(page)
    await gotoHydrated(page, '/ja')
    await page.waitForTimeout(500)
    expect(sent).toEqual([])
  })
})

/** CMS API を管理画面と同じヘッダーで呼ぶ（ページのコンテキストの Cookie を使う） */
async function report(page: Page, range: string) {
  const response = await page.request.get(`/api/admin/analytics?range=${range}`, {
    headers: { 'x-csrf-token': 'orpc' },
  })
  expect(response.status()).toBe(200)
  return (await response.json()) as {
    totals: { pageViews: number; visitors: number; outbound: number }
    pages: { path: string; pageViews: number }[]
    referrers: { key: string; count: number }[]
    rowExpands: { title: { ja: string | null; en: string | null } | null; count: number }[]
    outbounds: { host: string; count: number }[]
    readCompletes: { path: string; count: number }[]
    sectionReach: { rate: number | null }[]
    otherActions: { codeCopy: number }
    audience: {
      countries: { key: string; count: number }[]
      devices: { key: string; count: number }[]
      browserLangs: { key: string; count: number }[]
      siteLangs: { key: string; count: number }[]
    }
    series: { points: unknown[] }
    missingDays: number
  }
}

const format = (value: number) => new Intl.NumberFormat('ja-JP').format(value)

test.describe('A10 アクセス解析', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('デモの集計を出し、各表が API の応答と一致する', async ({ page, login }) => {
    await login({ admin: true })
    await page.goto('/admin/analytics')
    await expect(page.getByRole('heading', { name: 'アクセス解析', level: 1 })).toBeVisible()
    // 期間の初期値は30日
    await expect(page.getByRole('radiogroup', { name: '期間' }).getByRole('radio', { name: '30日' })).toBeChecked()
    const data = await report(page, '30d')

    await expect(page.getByText('この環境では計測していません。表示しているのは保存済みの集計だけです')).toBeVisible()
    await expect(page.getByText('今日の分を読めませんでした。表示は昨日までです')).toBeVisible()
    await expect(page.getByText('集計していない日があります（1日）。毎日 0:15 の集計で埋まります')).toBeVisible()
    expect(data.missingDays).toBe(1)

    const totals = page.locator('dl').first()
    await expect(totals).toContainText(`閲覧${format(data.totals.pageViews)}`)
    await expect(totals).toContainText(`訪問者${format(data.totals.visitors)}`)
    await expect(totals).toContainText(`外部へ${format(data.totals.outbound)}`)
    await expect(page.getByText('訪問者は日ごとの訪問者数の合計です')).toBeVisible()
    await expect(page.getByRole('group', { name: '推移の区切り' }).getByRole('button')).toHaveCount(
      data.series.points.length,
    )

    const firstRow = (name: string) => page.getByRole('table', { name, exact: true }).locator('tbody tr').first()
    const top = data.pages[0]
    expect(top).toBeDefined()
    await expect(firstRow('ページ')).toContainText(top?.path ?? '')
    await expect(firstRow('ページ')).toContainText(format(top?.pageViews ?? 0))
    await expect(firstRow('流入元')).toContainText(data.referrers[0]?.key ?? '')
    await expect(firstRow('広げた行')).toContainText(data.rowExpands[0]?.title?.ja ?? '')
    await expect(firstRow('押した外部リンク')).toContainText(data.outbounds[0]?.host ?? '')
    await expect(firstRow('最後まで読まれたページ')).toContainText(data.readCompletes[0]?.path ?? '')
    await expect(firstRow('国')).toContainText(format(data.audience.countries[0]?.count ?? 0))
    await expect(firstRow('デバイス')).toContainText(format(data.audience.devices[0]?.count ?? 0))
    await expect(firstRow('ブラウザの言語')).toContainText(format(data.audience.browserLangs[0]?.count ?? 0))
    await expect(firstRow('/ja と /en')).toContainText(`/${data.audience.siteLangs[0]?.key}`)
    await expect(firstRow('/ja と /en')).toContainText(format(data.audience.siteLangs[0]?.count ?? 0))
    await expect(page.getByRole('table', { name: 'その他の操作' })).toContainText(format(data.otherActions.codeCopy))
    await expect(page.getByRole('table', { name: 'P1 のセクション到達率' }).locator('tbody tr')).toHaveCount(7)
    await expect(page.getByRole('table', { name: 'P1 のセクション到達率' })).toContainText('100%')
    await expect(page.getByRole('table', { name: 'キャンペーン（UTM）' })).toBeVisible()
  })

  test('期間を切り替えると合計と推移が変わり、URL を置き換えて覚える', async ({ page, login }) => {
    await login({ admin: true })
    await page.goto('/admin/analytics')
    await expect(page.getByRole('radiogroup', { name: '期間' })).toBeVisible()
    const year = await report(page, '1y')
    await page.getByRole('radiogroup', { name: '期間' }).getByText('1年').click()
    await expect(page).toHaveURL(/\/admin\/analytics\?range=1y$/)
    await expect(page.locator('dl').first()).toContainText(`閲覧${format(year.totals.pageViews)}`)
    await expect(page.getByRole('group', { name: '推移の区切り' }).getByRole('button')).toHaveCount(
      year.series.points.length,
    )
    // 覚えた期間で開く
    await page.goto('/admin/analytics')
    await expect(page.getByRole('radiogroup', { name: '期間' }).getByRole('radio', { name: '1年' })).toBeChecked()

    const all = await report(page, 'all')
    await page.getByRole('radiogroup', { name: '期間' }).getByText('すべて').click()
    await expect(page.locator('dl').first()).toContainText(`閲覧${format(all.totals.pageViews)}`)
  })
})

test.describe('A2 の要約とサイドメニュー', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('昨日までの7日の要約から A10 の7日へ移り、覚えた期間は変わらない', async ({ page, login }) => {
    await login({ admin: true })
    await page.goto('/admin/analytics')
    await page.getByRole('radiogroup', { name: '期間' }).getByText('90日').click()
    await expect(page).toHaveURL(/range=90d$/)

    await page.goto('/admin')
    const dashboard = await page.request.get('/api/admin/dashboard', { headers: { 'x-csrf-token': 'orpc' } })
    const { analytics } = (await dashboard.json()) as { analytics: { pageViews: number; visitors: number } }
    await expect(
      page.getByText(`閲覧 ${format(analytics.pageViews)}・訪問者 ${format(analytics.visitors)}`),
    ).toBeVisible()
    await expect(page.getByText('（この環境では計測していません）')).toBeVisible()
    await page.getByRole('link', { name: 'アクセス解析を見る' }).click()
    await expect(page).toHaveURL(/\/admin\/analytics\?range=7d$/)
    await expect(page.getByRole('radiogroup', { name: '期間' }).getByRole('radio', { name: '7日' })).toBeChecked()

    await page.goto('/admin/analytics')
    await expect(page.getByRole('radiogroup', { name: '期間' }).getByRole('radio', { name: '90日' })).toBeChecked()
    // 読み込みを終えてからテストを終える（終わりにフィクスチャがセッションを消すのと、読み込みの途中の要求が重ならないように）
    await expect(page.getByRole('group', { name: '推移の区切り' })).toBeVisible()
  })

  test('サイドメニューの並びは Coding Log の後にアクセス解析、最後にプライバシー', async ({ page, login }) => {
    await login({ admin: true })
    await page.goto('/admin')
    const items = page.getByRole('navigation', { name: '管理メニュー' }).getByRole('list').first().getByRole('link')
    await expect(items).toHaveText([
      'ダッシュボード',
      'プロフィール',
      'Career',
      'Projects',
      'Lab',
      'Tech Stack',
      'Blog',
      'Coding Log',
      'アクセス解析',
      'プライバシー',
    ])
    await items.filter({ hasText: 'アクセス解析' }).click()
    await expect(page).toHaveURL(/\/admin\/analytics$/)
    await expect(items.filter({ hasText: 'アクセス解析' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('group', { name: '推移の区切り' })).toBeVisible()
  })
})

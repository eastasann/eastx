/**
 * 公開側のヘッダー・フッター・C1・C2（design-spec 3.1・6.1.2・1.4、SDD 4.1）。
 * make e2e のデモデータ（make db-seed）で、全セクションと SNS リンクがある状態を前提にする。
 * ヘッダーはサイト名・言語・テーマだけで、固定しない（design-spec 6.1.2）
 */
import { expect, test } from '@playwright/test'
import { gotoHydrated } from './hydration'

test.describe('C1 見つからないページ', () => {
  test('/ja/no-such はヘッダー・フッター付きの C1 で 404', async ({ page }) => {
    const response = await page.goto('/ja/no-such')
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1, name: 'ページが見つかりません' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja')

    const header = page.getByRole('banner')
    await expect(header.getByRole('link', { name: 'eastasian' })).toBeVisible()

    const footer = page.getByRole('contentinfo')
    await expect(footer).toContainText('© eastasian')
    const social = footer.getByRole('list', { name: 'SNS' })
    await expect(social.getByRole('link')).toHaveText(['GitHub', 'LinkedIn', 'X', 'Portfolio'])
    await expect(social.getByRole('link', { name: 'GitHub' })).toHaveAttribute('target', '_blank')

    await page.getByRole('link', { name: 'トップへ戻る' }).click()
    await expect(page).toHaveURL('/ja')
  })

  test('/en/no-such は英語の C1', async ({ page }) => {
    const response = await page.goto('/en/no-such')
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })

  test('言語が ja・en 以外なら、ルート / と同じ振り分けの言語で C1', async ({ browser }) => {
    for (const [locale, title, lang] of [
      ['en-US', 'Page not found', 'en'],
      ['ja-JP', 'ページが見つかりません', 'ja'],
    ] as const) {
      const context = await browser.newContext({ locale })
      const page = await context.newPage()
      const response = await page.goto('/xx/foo')
      expect(response?.status()).toBe(404)
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('lang', lang)
      await expect(page.getByRole('contentinfo')).toContainText('© eastasian')
      await context.close()
    }
  })
})

test.describe('C2 エラー', () => {
  test('中身の取得に失敗したら、ヘッダー付きの C2 と再読み込み', async ({ page }) => {
    await gotoHydrated(page, '/ja/no-such')
    // ブラウザでの移動で、ヘッダーとフッターの中身を読むサーバー関数を失敗させる
    await page.route('**/_serverFn/**', (route) => route.fulfill({ status: 500, body: 'error' }))
    await page.getByRole('group', { name: '言語' }).getByRole('link', { name: 'EN' }).click()
    await expect(page.getByRole('heading', { level: 1, name: "This page can't be displayed right now" })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
    await expect(page.getByRole('banner').getByRole('link', { name: 'eastasian' })).toBeVisible()

    await page.unroute('**/_serverFn/**')
    await page.getByRole('button', { name: 'Reload' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
  })
})

test.describe('テーマの切り替え', () => {
  test('OSに合わせる → ライト → ダークの順に切り替わり、読み込み直しても覚えている', async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await gotoHydrated(page, '/ja/no-such')
    const html = page.locator('html')
    await expect(html).toHaveAttribute('data-theme', 'dark')

    await page.getByRole('button', { name: 'テーマ: OSに合わせる（押すとライト）' }).click()
    await expect(html).toHaveAttribute('data-theme', 'light')
    await page.getByRole('button', { name: 'テーマ: ライト（押すとダーク）' }).click()
    await expect(html).toHaveAttribute('data-theme', 'dark')

    const cookie = (await context.cookies()).find((c) => c.name === 'eastx-theme')
    expect(cookie?.value).toBe('dark')

    await page.emulateMedia({ colorScheme: 'light' })
    await gotoHydrated(page, '/ja/no-such')
    await expect(html).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('button', { name: 'テーマ: ダーク（押すとOSに合わせる）' }).click()
    await expect(html).toHaveAttribute('data-theme', 'light')
  })

  test('OSに合わせる設定では、OS の設定の変化に付いていく', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await gotoHydrated(page, '/ja/no-such')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })
})

test.describe('言語の切り替え', () => {
  test('同じ画面の URL の言語だけを変え、選んだ言語をルート / の振り分けに使う', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'ja-JP' })
    const page = await context.newPage()
    await gotoHydrated(page, '/ja/no-such?x=1')
    const switcher = page.getByRole('group', { name: '言語' })
    await expect(switcher.locator('[aria-current="true"]')).toHaveText('JA')
    await switcher.getByRole('link', { name: 'EN' }).click()
    await expect(page).toHaveURL('/en/no-such?x=1')
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')

    const cookie = (await context.cookies()).find((c) => c.name === 'eastx-lang')
    expect(cookie?.value).toBe('en')

    // ブラウザの言語は日本語でも、選んだ言語（英語）へ振り分ける
    await page.goto('/')
    await expect(page).toHaveURL('/en')
    await context.close()
  })
})

test.describe('ヘッダーの形', () => {
  test('サイト名・言語・テーマだけを置き、セクションメニューは無く、スクロールしても固定しない', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    const header = page.getByRole('banner')
    await expect(header.getByRole('navigation')).toHaveCount(0)
    await expect(header.getByRole('button', { name: 'メニュー' })).toHaveCount(0)
    await expect(header.getByRole('link', { name: 'eastasian' })).toBeVisible()
    await expect(header.getByRole('group', { name: '言語' })).toBeVisible()
    await expect(header.getByRole('button', { name: /^テーマ/ })).toBeVisible()

    await page.locator('#blog').evaluate((element) => element.scrollIntoView())
    await expect(header).not.toBeInViewport()
  })

  test.describe('モバイル幅', () => {
    test.use({ viewport: { width: 375, height: 740 } })

    test('ヘッダーは1行で、ページの横にはみ出さない', async ({ page }) => {
      await gotoHydrated(page, '/ja/no-such')
      const header = page.getByRole('banner')
      const name = await header.getByRole('link', { name: 'eastasian' }).boundingBox()
      const theme = await header.getByRole('button', { name: /^テーマ/ }).boundingBox()
      if (!name || !theme) throw new Error('ヘッダーの部品が見えない')
      expect(Math.abs(name.y + name.height / 2 - (theme.y + theme.height / 2))).toBeLessThanOrEqual(2)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  })
})

test('公開側と管理画面のページは、favicon と iOS のホーム画面のアイコンを示し、どちらも画像を返す', async ({
  page,
  request,
}) => {
  for (const path of ['/ja', '/en/works/portfolio-cms', '/admin/login']) {
    await page.goto(path)
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.png')
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png')
  }
  for (const icon of ['/favicon.png', '/apple-touch-icon.png']) {
    const response = await request.get(icon)
    expect(response.status(), icon).toBe(200)
    expect(response.headers()['content-type'], icon).toBe('image/png')
  }
})

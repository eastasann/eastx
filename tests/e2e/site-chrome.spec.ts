/**
 * 公開側のヘッダー・フッター・C1・C2（design-spec 3.1・6.1.2・1.4、SDD 4.1）。
 * make e2e のデモデータ（make db-seed）で、全セクションと SNS リンクがある状態を前提にする
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
    const sections = header.getByRole('navigation', { name: 'セクション' })
    await expect(sections.getByRole('link')).toHaveText([
      '経歴',
      'プロジェクト',
      '作品',
      '使用技術',
      'ブログ',
      'コーディング記録',
    ])
    // 見つからないページでは、どのメニューも「今いる場所」にしない
    await expect(sections.locator('[aria-current]')).toHaveCount(0)

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
    await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link').first()).toHaveText('Career')
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

test.describe('モバイル幅のヘッダー', () => {
  test.use({ viewport: { width: 375, height: 740 } })

  test('セクションメニューはメニューボタンから開き、選ぶとトップのセクションへ移る', async ({ page }) => {
    await gotoHydrated(page, '/ja/no-such')
    const header = page.getByRole('banner')
    await expect(header.getByRole('navigation', { name: 'セクション' })).toBeHidden()
    await header.getByRole('button', { name: 'メニュー' }).click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem')).toHaveText([
      '経歴',
      'プロジェクト',
      '作品',
      '使用技術',
      'ブログ',
      'コーディング記録',
    ])
    await menu.getByRole('menuitem', { name: '作品' }).click()
    await expect(page).toHaveURL('/ja#works')
    await expect(menu).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})

test.describe('タブレット幅のヘッダー', () => {
  test('入りきるならメニューを横に並べ、入りきらなければメニューボタンにまとめる', async ({ page }) => {
    for (const width of [1023, 768]) {
      await page.setViewportSize({ width, height: 800 })
      await gotoHydrated(page, '/ja/no-such')
      const header = page.getByRole('banner')
      await expect(header.getByRole('navigation', { name: 'セクション' })).toBeVisible()
      await expect(header.getByRole('button', { name: 'メニュー' })).toBeHidden()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }

    // セクションの名前が入りきらない幅を、ヘッダーの右側を広げて作る
    await page.setViewportSize({ width: 800, height: 800 })
    await gotoHydrated(page, '/ja/no-such')
    await page.addStyleTag({ content: 'header > div:last-child { padding-left: 400px }' })
    const header = page.getByRole('banner')
    await expect(header.getByRole('button', { name: 'メニュー' })).toBeVisible()
    await expect(header.getByRole('navigation', { name: 'セクション' })).toBeHidden()
    await header.getByRole('button', { name: 'メニュー' }).click()
    await expect(page.getByRole('menu').getByRole('menuitem')).toHaveCount(6)
  })
})

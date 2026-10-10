/**
 * 管理画面のサイドメニューと L4 の外枠（design-spec 3.3・4.1・4.3）。
 * デスクトップ・タブレット・モバイルの幅で、崩れず（横にはみ出さず）に使えることを確かめる
 */
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

const MENU = [
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
]

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

test.describe('デスクトップ幅（≥1024px）', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('サイドメニューを常に出し、項目・ユーザー名・テーマ・ログアウトを並べる', async ({ page, login }) => {
    const { githubLogin } = await login({ admin: true })
    await page.goto('/admin')
    const nav = page.getByRole('navigation', { name: '管理メニュー' })
    await expect(nav.getByRole('link')).toHaveText(MENU)
    await expect(nav.getByRole('link', { name: 'ダッシュボード' })).toHaveAttribute('aria-current', 'page')
    await expect(nav.getByText(`@${githubLogin}`)).toBeVisible()
    await expect(nav.getByRole('button', { name: /^テーマ: / })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'ログアウト' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible()

    const box = await nav.boundingBox()
    expect(box?.width).toBeGreaterThan(200)
    await expectNoHorizontalOverflow(page)
  })

  test('テーマの切り替えを覚え、公開側にも効く', async ({ page, login }) => {
    await login({ admin: true })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('/admin')
    const nav = page.getByRole('navigation', { name: '管理メニュー' })
    await nav.getByRole('button', { name: 'テーマ: OSに合わせる（押すとライト）' }).click()
    await nav.getByRole('button', { name: 'テーマ: ライト（押すとダーク）' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.goto('/ja/no-such')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })
})

test.describe('タブレット幅（768〜1023px）', () => {
  test.use({ viewport: { width: 900, height: 800 } })

  test('サイドメニューをアイコンだけに縮め、名前は読み上げ名とツールチップで補う', async ({ page, login }) => {
    await login({ admin: true })
    await page.goto('/admin')
    const nav = page.getByRole('navigation', { name: '管理メニュー' })
    await expect(nav.getByRole('link')).toHaveCount(MENU.length)
    for (const name of MENU) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible()
    await expect(nav.getByText('ダッシュボード', { exact: true })).toHaveCount(0)

    const box = await nav.boundingBox()
    expect(box?.width).toBeLessThan(80)

    await nav.getByRole('link', { name: 'Lab' }).hover()
    await expect(page.getByRole('tooltip')).toHaveText('Lab')
    await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})

test.describe('モバイル幅（<768px）', () => {
  test.use({ viewport: { width: 375, height: 740 } })

  test('サイドメニューはメニューボタンから引き出しで開き、項目を選ぶと閉じる', async ({ page, login }) => {
    const { githubLogin } = await login({ admin: true })
    await page.goto('/admin')
    await expect(page.getByRole('navigation', { name: '管理メニュー' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.getByRole('button', { name: 'メニュー' }).click()
    const drawer = page.getByRole('dialog', { name: '管理メニュー' })
    const nav = drawer.getByRole('navigation', { name: '管理メニュー' })
    await expect(nav.getByRole('link')).toHaveText(MENU)
    await expect(nav.getByText(`@${githubLogin}`)).toBeVisible()
    await expect(nav.getByRole('button', { name: 'ログアウト' })).toBeVisible()

    await nav.getByRole('link', { name: 'ダッシュボード' }).click()
    await expect(drawer).toBeHidden()
    await expect(page).toHaveURL('/admin')

    await page.getByRole('button', { name: 'メニュー' }).click()
    await page.getByRole('button', { name: '閉じる' }).click()
    await expect(drawer).toBeHidden()
  })
})

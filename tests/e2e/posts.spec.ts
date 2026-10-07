/**
 * P4 ブログ記事・P5 コーディング記録詳細（design-spec 6.3）。トップの行から開き、メタ情報・前後のナビ・戻るリンクを確かめる。
 * make e2e のデモデータ（make db-seed）を前提にする
 */
import { expect, test } from './fixtures'
import { gotoHydrated } from './hydration'

test('トップのブログの行から P4 を開き、前後のナビで移り、戻るでブログのセクションへ', async ({ page }) => {
  await gotoHydrated(page, '/ja')
  const firstPost = page.locator('#blog').getByRole('article').first().getByRole('link').first()
  const title = (await firstPost.innerText()).trim()
  await firstPost.click()

  await expect(page).toHaveURL(/\/ja\/blog\/[a-z0-9-]+$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
  await expect(page.locator('header time').first()).toBeVisible()
  // 公開日の新しい順の先頭なので、新しい記事はなく古い記事だけがある
  const nav = page.getByRole('navigation', { name: '前後のページ' })
  await expect(nav.getByRole('link', { name: /新しい記事/ })).toHaveCount(0)
  const older = nav.getByRole('link', { name: /古い記事/ })
  await older.click()
  await expect(
    page.getByRole('navigation', { name: '前後のページ' }).getByRole('link', { name: /新しい記事/ }),
  ).toBeVisible()
  await expect(page).toHaveTitle(/ — eastasian$/)

  await page.getByRole('link', { name: 'Blog へ戻る' }).click()
  await expect(page).toHaveURL(/\/ja#blog$/)
})

test('P5 は種類ラベルを出し、存在しないスラッグは C1', async ({ page }) => {
  await gotoHydrated(page, '/en')
  const row = page.locator('#coding').getByRole('article').first()
  const kind = (
    await row
      .locator('span')
      .filter({ hasText: /^(Learning Log|Snippet|Problem Solving|Tech Memo)$/ })
      .first()
      .innerText()
  ).trim()
  await row.getByRole('link').first().click()
  await expect(page).toHaveURL(/\/en\/coding\/[a-z0-9-]+$/)
  await expect(page.getByRole('article').locator('header').getByText(kind, { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Back to Coding Log' })).toBeVisible()

  const response = await page.goto('/ja/coding/no-such-log')
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'ページが見つかりません' })).toBeVisible()
})

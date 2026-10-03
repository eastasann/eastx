import { expect, test } from '@playwright/test'

// Step 1 の骨格の確認。コアフローの E2E は Step 10 で書く（SDD 10章）

test('/ は言語の振り分けで /ja か /en に移る', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/(ja|en)$/)
})

// トップの見出しはプロフィールの名前（make e2e のデモデータ）
test('/ja が SSR でトップを出す', async ({ page }) => {
  const response = await page.goto('/ja')
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1, name: '東 アジア' })).toBeVisible()
})

test('/en が SSR でトップを出す', async ({ page }) => {
  const response = await page.goto('/en')
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1, name: 'Asia Higashi' })).toBeVisible()
})

test('ja・en 以外の言語は 404', async ({ page }) => {
  const response = await page.goto('/xx')
  expect(response?.status()).toBe(404)
})

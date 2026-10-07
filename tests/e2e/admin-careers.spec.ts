/**
 * A4 経歴管理（design-spec 6.6・6.7）。一覧の絞り込み・作成・下書き保存・公開・更新・非公開に戻す・削除
 */
import { expect, test } from './fixtures'

test.use({ viewport: { width: 1280, height: 900 } })

test('一覧を出し、状態と種類で絞り込み、絞り込みを解除できる', async ({ page, login }) => {
  await login({ admin: true })
  await page.goto('/admin/careers')
  const table = page.getByRole('table', { name: 'Career の一覧' })
  // 読み込み中のスケルトンの行を数えないよう、状態の列が出るまで待つ
  await expect(table.locator('tbody td:nth-child(5)').first()).toHaveText(/^(公開|下書き)$/)
  const total = await table.getByRole('row').count()

  // 公開中の行の「⋯」には、公開サイトのトップの経歴のセクションへのリンクがある（design-spec 6.6）
  const published = table
    .getByRole('row')
    .filter({ has: page.locator('td:nth-child(5)', { hasText: /^公開$/ }) })
    .first()
  await published.getByRole('button', { name: /の操作$/ }).click()
  const view = page.getByRole('menuitem', { name: '公開サイトで見る' })
  await expect(view).toHaveAttribute('href', '/ja#career')
  await expect(view).toHaveAttribute('target', '_blank')
  await page.keyboard.press('Escape')

  await page.getByRole('combobox', { name: '状態' }).click()
  await page.getByRole('option', { name: '下書き' }).click()
  await expect(page).toHaveURL(/status=draft/)
  const statusCells = table.locator('tbody td:nth-child(5)')
  await expect(statusCells.filter({ hasText: /^公開$/ })).toHaveCount(0)
  await expect(statusCells.filter({ hasText: /^下書き$/ }).first()).toBeVisible()

  await page.getByRole('combobox', { name: '種類' }).click()
  await page.getByRole('option', { name: '学歴' }).click()
  await expect(page).toHaveURL(/kind=education/)
  await expect(page.getByText('条件に合うものがありません')).toBeVisible()
  await page.getByRole('button', { name: '絞り込みを解除' }).click()
  await expect(table.getByRole('row')).toHaveCount(total)
})

test('作成 → 下書き保存 → 公開 → 更新 → 非公開に戻す → 削除', async ({ page, login }) => {
  await login({ admin: true })
  await page.goto('/admin/careers')
  await page.getByRole('link', { name: '新規作成' }).click()
  await expect(page).toHaveURL(/\/admin\/careers\/new$/)
  await expect(page.getByText('下書き（未保存）')).toBeVisible()

  // 下書きのルール: タイトルが日英とも空なら保存しない
  await page.getByRole('button', { name: '下書き保存' }).click()
  await expect(page.getByText('タイトルを日本語か英語のどちらかに入力してください').first()).toBeVisible()

  const title = `E2E 経歴 ${Date.now()}`
  await page.getByLabel('タイトル').first().fill(title)
  await page.getByRole('button', { name: '下書き保存' }).click()
  await expect(page.getByText('保存しました')).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/careers\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()

  // 公開のルール: 開始年月がないと公開できない
  await page.getByRole('button', { name: '公開する' }).click()
  await expect(page.getByRole('alert').getByText('公開に必要な項目が足りません')).toBeVisible()
  await expect(page.getByRole('alert').getByText('開始年月')).toBeVisible()

  await page.getByLabel('開始年月').fill('2020-04')
  await page.getByRole('button', { name: '公開する' }).click()
  await expect(page.getByText('公開しました')).toBeVisible()
  await expect(page.getByText('公開', { exact: true })).toBeVisible()

  await page.getByLabel('所属').first().fill('E2E 株式会社')
  await page.getByRole('button', { name: '更新する' }).click()
  await expect(page.getByText('更新しました')).toBeVisible()

  await page.goto('/ja')
  await expect(page.getByText(title)).toBeVisible()
  await page.goBack()

  await page.getByRole('button', { name: '非公開に戻す' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '非公開に戻す' }).click()
  await expect(page.getByText('非公開に戻しました')).toBeVisible()
  await expect(page.getByRole('button', { name: '公開する' })).toBeVisible()

  await page.getByRole('button', { name: '削除' }).click()
  await expect(page.getByRole('dialog')).toContainText(`『${title}』を削除します。元に戻せません`)
  await page.getByRole('dialog').getByRole('button', { name: '削除する' }).click()
  await expect(page).toHaveURL(/\/admin\/careers$/)
  await expect(page.getByText('削除しました')).toBeVisible()
  await expect(page.getByRole('table', { name: 'Career の一覧' }).getByText(title)).toHaveCount(0)
})

test.describe('モバイル幅（<768px）', () => {
  test.use({ viewport: { width: 375, height: 800 } })

  test('一覧はタイトル・状態・操作の列だけを残す', async ({ page, login }) => {
    await login({ admin: true })
    await page.goto('/admin/careers')
    const table = page.getByRole('table', { name: 'Career の一覧' })
    await expect(table.getByRole('columnheader')).toHaveText(['タイトル', '状態', '操作'])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})

/**
 * P6 プライバシーと A11 プライバシー編集（design-spec 6.1.2・6.2.4・6.4・6.7）。
 * make e2e のデモデータ（make db-seed）で、プライバシーのページの本文が日英ともある状態を前提にする。
 * 本文を書き換えるので、各テストの後にシードの本文へ必ず戻す（失敗しても後のテストに空の本文を残さない）
 */
import type { Page } from '@playwright/test'
import { buildSeed } from '../../scripts/seed/data'
import * as schema from '../../src/db/schema'
import { expect, test, whenUnlocked } from './fixtures'
import { gotoHydrated } from './hydration'

test.use({ viewport: { width: 1440, height: 840 } })

const SEEDED = buildSeed({ empty: false }).privacyPage

test.afterEach(async ({ local, context }) => {
  // 開いたままのページがプレビューの Worker を通して同じ D1 のファイルを使っていると SQLITE_BUSY になるので、
  // 先に閉じ、Worker が受けた要求が終わるのを待ってやり直す（fixtures.ts の login の片付けと同じ）
  for (const opened of context.pages()) await opened.close()
  await whenUnlocked(() =>
    local.db.batch([local.db.delete(schema.privacyPage), local.db.insert(schema.privacyPage).values(SEEDED)]),
  )
})

/** 本文の欄。言語タブの隠れたパネルの欄は数えない */
function bodyFields(page: Page) {
  return page.getByRole('textbox', { name: '本文' })
}

/** 表示の切り替えの項目（見た目はアイコンだけ。名前は読み上げの文字とツールチップにある） */
function viewItem(page: Page, name: string) {
  return page
    .getByRole('radiogroup', { name: '表示' })
    .locator('label')
    .filter({ has: page.getByText(name, { exact: true }) })
}

/** 操作バーの保存の状態 */
function saveStatus(page: Page) {
  return page.getByRole('status').filter({ hasText: /^(未保存|未保存の変更|保存しています…|保存済み.*)$/ })
}

function publicLink(page: Page) {
  return page.getByRole('link', { name: /公開サイトで見る/ })
}

test.describe('P6 プライバシー', () => {
  for (const { lang, title, updated, heading } of [
    { lang: 'ja', title: 'プライバシー', updated: /^最終更新 \d{4}年\d{1,2}月\d{1,2}日$/, heading: 'アクセスの集計' },
    { lang: 'en', title: 'Privacy', updated: /^Last updated [A-Z][a-z]{2} \d{1,2}, \d{4}$/, heading: 'Analytics' },
  ] as const) {
    test(`/${lang}: フッターのリンクから移り、タイトル・最終更新日・本文が出る`, async ({ page }) => {
      await gotoHydrated(page, `/${lang}`)
      await page.getByRole('contentinfo').getByRole('link', { name: title, exact: true }).click()
      await expect(page).toHaveURL(`/${lang}/privacy`)
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
      await expect(page.getByText(updated)).toBeVisible()
      await expect(page.getByRole('heading', { name: heading })).toBeVisible()
      // 表示中の言語の本文があるので注記は出さない。戻るリンクと前後のナビも持たない
      await expect(page.getByRole('note')).toHaveCount(0)
      await expect(page.getByRole('navigation', { name: /前後|Previous and next/ })).toHaveCount(0)
    })
  }

  test('C1 のフッターにもリンクがあり、並びは「© eastasian」「プライバシー」、SNS', async ({ page }) => {
    const response = await page.goto('/ja/works/none')
    expect(response?.status()).toBe(404)
    const footer = page.getByRole('contentinfo')
    await expect(footer.getByRole('link', { name: 'プライバシー', exact: true })).toHaveAttribute('href', '/ja/privacy')
    await expect(footer).toContainText(/© eastasian\s*プライバシー\s*GitHub/)
  })
})

test.describe('A11 プライバシー編集', () => {
  test('英語の本文を空にして保存すると、/en/privacy に注記と日本語の本文が出る', async ({ page, login }) => {
    await login({ admin: true })
    await page.goto('/admin/privacy')
    await page.getByRole('tab', { name: /English/ }).click()
    // 切り替えの直後は、出ていく日本語のパネルの欄も見えているので、英語のパネルに絞る
    const enBody = page.getByRole('tabpanel', { name: /English/ }).getByRole('textbox', { name: '本文' })
    await expect(enBody).toHaveValue(/## Analytics/)
    await enBody.fill('')
    await page.getByRole('button', { name: '保存' }).click()
    await expect(page.getByText('保存しました', { exact: true })).toBeVisible()
    // 英語のタブに「言語ありでない」の印が付く
    await expect(page.getByRole('tab', { name: /English/ })).toContainText('○')

    await page.goto('/en/privacy')
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible()
    await expect(page.getByRole('note')).toHaveText('This page is available in Japanese only.')
    await expect(page.locator('[lang="ja"]').getByRole('heading', { name: 'アクセスの集計' })).toBeVisible()
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Privacy', exact: true })).toBeVisible()
  })

  test('「日英」で日英とも空にして保存すると、通知に添え書きが出て、フッターのリンクが消え、/ja/privacy は C1', async ({
    page,
    login,
  }) => {
    await login({ admin: true })
    await page.goto('/admin/privacy')
    await expect(publicLink(page)).toHaveAttribute('href', '/ja/privacy')
    await expect(publicLink(page)).toHaveAttribute('target', '_blank')

    await viewItem(page, '日英').click()
    await expect(page.getByRole('tab')).toHaveCount(0)
    await expect(bodyFields(page)).toHaveCount(2)
    await bodyFields(page).nth(0).fill('')
    await bodyFields(page).nth(1).fill('')
    await page.getByRole('button', { name: '保存' }).click()
    await expect(page.getByText('保存しました。本文が空なので、公開サイトにはページとリンクが出ません')).toBeVisible()
    // 公開サイトにページが無くなったので、「公開サイトで見る」も出さない
    await expect(publicLink(page)).toHaveCount(0)

    const response = await page.goto('/ja/privacy')
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1, name: 'ページが見つかりません' })).toBeVisible()
    await page.goto('/ja')
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'プライバシー' })).toHaveCount(0)
  })

  test('行がまだ無ければ空のフォームで、「公開サイトで見る」は保存して本文ができてから出る', async ({
    page,
    login,
    local,
  }) => {
    await login({ admin: true })
    await whenUnlocked(() => local.db.delete(schema.privacyPage))
    await page.goto('/admin/privacy')
    await expect(saveStatus(page)).toHaveText('未保存')
    await expect(bodyFields(page)).toHaveValue('')
    await expect(publicLink(page)).toHaveCount(0)

    await bodyFields(page).fill('## 初めての本文')
    // 入力中の本文では出さない（公開サイトに出ているのは保存した本文）
    await expect(publicLink(page)).toHaveCount(0)
    await page.getByRole('button', { name: '保存' }).click()
    await expect(page.getByText('保存しました', { exact: true })).toBeVisible()
    await expect(publicLink(page)).toBeVisible()
    await expect(saveStatus(page)).toHaveText(/^保存済み \d{2}:\d{2}$/)
  })

  test('Cmd/Ctrl+S で保存し、保存の状態が「未保存の変更」から「保存済み」に変わる。変更が無ければ送らない', async ({
    page,
    login,
  }) => {
    await login({ admin: true })
    await page.goto('/admin/privacy')
    await expect(saveStatus(page)).toHaveText(/^保存済み/)
    await bodyFields(page).fill('## アクセスの集計\n\nショートカットで保存した本文')
    await expect(saveStatus(page)).toHaveText('未保存の変更')
    await bodyFields(page).press('ControlOrMeta+s')
    await expect(page.getByText('保存しました', { exact: true })).toBeVisible()
    await expect(saveStatus(page)).toHaveText(/^保存済み \d{2}:\d{2}$/)

    let sent = 0
    page.on('request', (request) => {
      if (request.method() === 'PUT' && request.url().endsWith('/api/admin/privacy')) sent++
    })
    await page.keyboard.press('ControlOrMeta+s')
    await page.waitForTimeout(500)
    expect(sent).toBe(0)

    await page.goto('/ja/privacy')
    await expect(page.getByText('ショートカットで保存した本文')).toBeVisible()
  })

  test('保存中は保存のボタンを押せず、ボタンの左に「保存しています」を出す', async ({ page, login }) => {
    await login({ admin: true })
    await page.goto('/admin/privacy')
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('**/api/admin/privacy', async (route) => {
      if (route.request().method() !== 'PUT') return route.continue()
      await held
      return route.continue()
    })
    await bodyFields(page).fill('## アクセスの集計\n\n保存中の本文')
    await page.getByRole('button', { name: '保存' }).click()
    await expect(page.getByRole('status').filter({ hasText: /^保存しています$/ })).toBeVisible()
    await expect(saveStatus(page)).toHaveText('保存しています…')
    await expect(page.getByRole('button', { name: '保存中…' })).toBeDisabled()

    release()
    await expect(page.getByText('保存しました', { exact: true })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: /^保存しています$/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '保存' })).toBeEnabled()
  })

  test('自動退避: 入力して読み込み直すと復元を提案し、復元すると入力が戻る', async ({ page, login }) => {
    await login({ admin: true })
    await page.goto('/admin/privacy')
    await bodyFields(page).fill('退避した本文')
    // 1秒待ってから書く。キーは行の id（SDD ADR-008）
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Object.keys(localStorage).filter(
              (key) => key.startsWith('eastx:backup:privacy:') && key !== 'eastx:backup:privacy:new',
            ),
          ),
        { timeout: 3000 },
      )
      .toHaveLength(1)

    page.on('dialog', (dialog) => void dialog.accept())
    await page.reload()
    const banner = page.getByRole('status').filter({ hasText: '一時保存した内容があります' })
    await expect(banner).toContainText(/（\d{2}:\d{2}）/)
    await expect(bodyFields(page)).toHaveValue(/## アクセスの集計/)
    await banner.getByRole('button', { name: '復元する' }).click()
    await expect(bodyFields(page)).toHaveValue('退避した本文')
    await expect(saveStatus(page)).toHaveText('未保存の変更')
  })

  test('保存していない変更があれば、別の画面へ移る前に確認する', async ({ page, login }) => {
    await login({ admin: true })
    await page.goto('/admin/privacy')
    await bodyFields(page).fill('書きかけの本文')
    const nav = page.getByRole('navigation', { name: '管理メニュー' })
    await nav.getByRole('link', { name: 'Tech Stack' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('保存していない変更があります。移動しますか？')
    await dialog.getByRole('button', { name: 'キャンセル' }).click()
    await expect(page).toHaveURL(/\/admin\/privacy$/)
    await expect(bodyFields(page)).toHaveValue('書きかけの本文')

    await nav.getByRole('link', { name: 'Tech Stack' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '移動する' }).click()
    await expect(page).toHaveURL(/\/admin\/stacks$/)
  })
})

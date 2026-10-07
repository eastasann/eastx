/**
 * 編集ビューの操作（design-spec 6.4・6.7）: 固定の操作バー、Cmd/Ctrl+S、表示の切り替え（日英）、誤りの欄への移動、
 * 設定の引き出し、自動退避と復元の提案、使用技術を続けて選ぶ、画像を挿入、L6 の「日英」、ログアウトで退避を消す。
 * make e2e のデモデータ（make db-seed）を前提にする。作ったものはテストの中で消す
 */
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

test.use({ viewport: { width: 1440, height: 840 } })

/** 1×1 の PNG。アップロードは先頭のバイトでも形式を確かめる（SDD 5.10）ので、本物の PNG にする */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

function viewSwitch(page: Page) {
  return page.getByRole('radiogroup', { name: '表示' })
}

/** 表示の切り替えの項目（見た目はアイコンだけ。名前は読み上げの文字とツールチップにある） */
function viewItem(page: Page, name: string) {
  return viewSwitch(page)
    .locator('label')
    .filter({ has: page.getByText(name, { exact: true }) })
}

/** 操作バーの保存の状態 */
function saveStatus(page: Page) {
  return page.getByRole('status').filter({ hasText: /^(未保存|未保存の変更|保存しています…|保存済み.*)$/ })
}

async function deleteFromEditor(page: Page, listPath: RegExp) {
  await page.getByRole('button', { name: '削除' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '削除する' }).click()
  await expect(page).toHaveURL(listPath)
}

test('L5: 長い本文を書いてスクロールしても、操作バーが見えている', async ({ page, login }) => {
  await login({ admin: true })
  await page.goto('/admin/blog/new')
  const editor = page.getByRole('textbox', { name: '本文（日本語）' })
  await editor.fill(Array.from({ length: 200 }, (_, index) => `行 ${index + 1}`).join('\n\n'))
  await editor.press('Control+End')
  await expect(page.getByText('行 200', { exact: true }).first()).toBeInViewport()
  await expect(page.getByRole('button', { name: '下書き保存' })).toBeInViewport()
  // 画面の高さに収め、ページ全体はスクロールしない（エディタの中でスクロールする）
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true)
  // 「並べる」では、プレビューがエディタのスクロールに追従する
  await expect(page.getByRole('region', { name: 'プレビュー' }).getByText('行 200', { exact: true })).toBeInViewport()
})

test('Cmd/Ctrl+S: 新規作成は作成して URL を置き換え、下書きは下書きのまま、公開中は更新として保存する', async ({
  page,
  login,
}) => {
  await login({ admin: true })
  const stamp = Date.now()
  await page.goto('/admin/blog/new')
  await expect(saveStatus(page)).toHaveText('未保存')
  await page.getByLabel('タイトル').first().fill(`E2E ショートカット ${stamp}`)
  await page.keyboard.press('ControlOrMeta+s')
  await expect(page.getByText('保存しました')).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/blog\/[0-9a-f-]{36}$/)
  await expect(saveStatus(page)).toHaveText(/^保存済み \d{2}:\d{2}$/)
  await expect(page.getByText('下書き', { exact: true })).toBeVisible()

  // 下書き: 本文を書くと「未保存の変更」になり、エディタの中の Cmd/Ctrl+S でも下書きのまま保存する
  const editor = page.getByRole('textbox', { name: '本文（日本語）' })
  await editor.fill('ショートカットで保存した本文')
  await expect(saveStatus(page)).toHaveText('未保存の変更')
  await editor.press('ControlOrMeta+s')
  await expect(saveStatus(page)).toHaveText(/^保存済み/)
  await expect(page.getByText('下書き', { exact: true })).toBeVisible()

  // 公開中: 更新として保存する
  await page.getByRole('textbox', { name: 'スラッグ' }).fill(`e2e-shortcut-${stamp}`)
  await page.getByRole('button', { name: '公開する' }).click()
  await expect(page.getByText('公開しました')).toBeVisible()
  await editor.fill('更新した本文')
  await editor.press('ControlOrMeta+s')
  await expect(page.getByText('更新しました')).toBeVisible()
  await expect(page.getByText('公開', { exact: true })).toBeVisible()
  await expect(saveStatus(page)).toHaveText(/^保存済み \d{2}:\d{2}$/)

  // 変更が無ければ何も送らない
  let sent = 0
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().includes('/api/admin/blog-posts/')) sent++
  })
  await page.keyboard.press('ControlOrMeta+s')
  await page.waitForTimeout(500)
  expect(sent).toBe(0)

  // 確認ダイアログが開いているあいだは、変更があっても保存しない
  await editor.fill('確認ダイアログの前の本文')
  await page.getByRole('button', { name: '非公開に戻す' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+s')
  await page.waitForTimeout(500)
  expect(sent).toBe(0)
  await page.getByRole('dialog').getByRole('button', { name: 'キャンセル' }).click()
  await expect(saveStatus(page)).toHaveText('未保存の変更')

  await deleteFromEditor(page, /\/admin\/blog$/)
})

test('「日英」: 日英の本文を並べて書き、保存できる', async ({ page, login }) => {
  await login({ admin: true })
  const stamp = Date.now()
  await page.goto('/admin/works/new')
  await viewItem(page, '日英').click()
  // 言語タブを出さず、言語ごとの欄を左右に並べる
  await expect(page.getByRole('tab', { name: /English/ })).toHaveCount(0)
  await page.getByRole('textbox', { name: 'タイトル' }).nth(0).fill(`E2E 日英 ${stamp}`)
  await page.getByRole('textbox', { name: 'タイトル' }).nth(1).fill(`E2E Bilingual ${stamp}`)
  await page.getByRole('textbox', { name: '詳細本文（日本語）' }).fill('日本語の本文')
  await page.getByRole('textbox', { name: '詳細本文（英語）' }).fill('English body')
  await page.getByRole('button', { name: '下書き保存' }).click()
  await expect(page.getByText('保存しました')).toBeVisible()

  // 表示の切り替えは覚えておく
  await page.reload()
  await expect(viewSwitch(page).getByRole('radio', { name: '日英' })).toBeChecked()
  // 選んでいる項目に印が付く（ツールチップが項目の data-state を上書きしない）
  await expect(viewItem(page, '日英')).toHaveAttribute('data-state', 'checked')
  await expect(viewItem(page, '並べる')).toHaveAttribute('data-state', 'unchecked')
  await expect(page.getByRole('textbox', { name: '詳細本文（日本語）' })).toHaveText('日本語の本文')
  await expect(page.getByRole('textbox', { name: '詳細本文（英語）' })).toHaveText('English body')
  await deleteFromEditor(page, /\/admin\/works$/)
})

test('誤りがあれば最初の誤りの欄へ移り、隠れた言語タブに切り替えて、件数を通知する', async ({ page, login }) => {
  await login({ admin: true })
  await page.goto('/admin/blog/new')
  await page.getByLabel('タイトル').first().fill('本文の無い記事')
  await page.getByRole('tab', { name: /English/ }).click()
  await page.getByRole('button', { name: '公開する' }).click()
  // 足りないのは日本語の本文とスラッグ。並びの最初（本文）へ移る
  await expect(page.getByText('確かめる項目があります（2件）')).toBeVisible()
  await expect(page.getByRole('tab', { name: /日本語/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('textbox', { name: '本文（日本語）' })).toBeFocused()
})

test.describe('幅 1280px 未満', () => {
  test.use({ viewport: { width: 1200, height: 800 } })

  test('設定は引き出しで直し、設定の欄に誤りがあれば「設定」ボタンに印を付けて引き出しを開く', async ({
    page,
    login,
  }) => {
    await login({ admin: true })
    const stamp = Date.now()
    await page.goto('/admin/works/new')
    await expect(page.getByRole('textbox', { name: 'スラッグ' })).toBeHidden()
    await page.getByLabel('タイトル').first().fill(`E2E 引き出し ${stamp}`)
    await page.getByRole('button', { name: '公開する' }).click()
    // 足りないのはスラッグだけ。引き出しを開いてスラッグの欄へ移る
    const drawer = page.getByRole('dialog', { name: '設定' })
    const slug = drawer.getByRole('textbox', { name: 'スラッグ' })
    await expect(slug).toBeFocused()
    // 引き出しのあいだは外が読み上げから外れるので、閉じてから「設定」ボタンの印を確かめる
    await page.keyboard.press('Escape')
    const settings = page.getByRole('button', { name: /設定/ })
    await expect(settings).toContainText('要確認')
    await settings.click()
    await slug.fill(`e2e-drawer-${stamp}`)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '公開する' }).click()
    await expect(page.getByText('公開しました')).toBeVisible()
    await expect(page.getByRole('button', { name: /設定/ })).not.toContainText('要確認')
    await deleteFromEditor(page, /\/admin\/works$/)
  })
})

test('自動退避: 入力して再読み込みすると復元を提案し、答える前に退避は消えず、復元すると入力が戻る', async ({
  page,
  login,
}) => {
  await login({ admin: true })
  await page.goto('/admin/blog/new')
  await page.getByLabel('タイトル').first().fill('退避した記事')
  await page.getByRole('textbox', { name: '本文（日本語）' }).fill('退避した本文')
  // 1秒待ってから書く
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('eastx:backup:blog-post:new')), { timeout: 3000 })
    .not.toBeNull()

  page.on('dialog', (dialog) => void dialog.accept())
  await page.reload()
  const banner = page.getByRole('status').filter({ hasText: '一時保存した内容があります' })
  await expect(banner).toContainText(/（\d{2}:\d{2}）/)
  // 提案に答えずにもう一度読み込んでも、提案が出続ける
  await page.reload()
  await expect(banner).toBeVisible()
  await banner.getByRole('button', { name: '復元する' }).click()
  await expect(page.getByLabel('タイトル').first()).toHaveValue('退避した記事')
  await expect(page.getByRole('textbox', { name: '本文（日本語）' })).toHaveText('退避した本文')
  await expect(saveStatus(page)).toHaveText('未保存')
})

test('使用技術は検索の欄を閉じずに続けて選べ、もう一度選ぶと外す', async ({ page, login }) => {
  await login({ admin: true })
  await page.goto('/admin/works/new')
  await page.getByRole('button', { name: '追加', exact: true }).click()
  const options = page.getByRole('option')
  const names: string[] = []
  for (let index = 0; index < 3; index++) {
    const option = options.nth(index)
    names.push((await option.locator('[data-part="item-text"]').innerText()).trim())
    await option.click()
  }
  const chosen = page.getByRole('list', { name: '選んだ使用技術（並びがトップの行に出る順）' }).getByRole('listitem')
  await expect(chosen).toHaveText(names)
  await expect(page.getByRole('combobox', { name: '使用技術を検索' })).toBeVisible()
  await options.nth(1).click()
  await expect(chosen).toHaveText([names[0] ?? '', names[2] ?? ''])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('combobox', { name: '使用技術を検索' })).toHaveCount(0)
})

test('「画像を挿入」で選んだ画像をアップロードし、本文に画像の記法を入れる', async ({ page, login }) => {
  await login({ admin: true })
  await page.goto('/admin/blog/new')
  const editor = page.getByRole('textbox', { name: '本文（日本語）' })
  await editor.fill('本文')
  await editor.press('Control+End')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '画像を挿入' }).first().click()
  await (await chooser).setFiles({ name: 'insert.png', mimeType: 'image/png', buffer: PNG })
  await expect(editor).toContainText(/本文!\[insert\]\(\/media\/uploads\/[^)]+\.png\)/)
})

test('L6（経歴）: 「日英」で両方を書いて保存できる', async ({ page, login }) => {
  await login({ admin: true })
  const stamp = Date.now()
  await page.goto('/admin/careers/new')
  await viewItem(page, '日英').click()
  await expect(page.getByRole('tab', { name: /English/ })).toHaveCount(0)
  await page.getByLabel('タイトル').nth(0).fill(`E2E 経歴 ${stamp}`)
  await page.getByLabel('タイトル').nth(1).fill(`E2E Career ${stamp}`)
  await page.getByLabel('所属').nth(1).fill('E2E Inc.')
  await page.getByRole('button', { name: '下書き保存' }).click()
  await expect(page.getByText('保存しました')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('タイトル').nth(1)).toHaveValue(`E2E Career ${stamp}`)
  await expect(page.getByLabel('所属').nth(1)).toHaveValue('E2E Inc.')
  await deleteFromEditor(page, /\/admin\/careers$/)
})

test('ログアウトすると、このブラウザの退避をすべて消す', async ({ page, login }) => {
  await login({ admin: true })
  await page.goto('/admin/blog/new')
  await page.getByLabel('タイトル').first().fill('ログアウトの前に書いた記事')
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('eastx:backup:blog-post:new')), { timeout: 3000 })
    .not.toBeNull()
  // 移動の確認を出さないよう、保存していない変更の無い画面からログアウトする
  await page.evaluate(() => localStorage.setItem('eastx:backup:career:other', '{}'))
  await page.goto('/admin')
  await page.getByRole('button', { name: 'ログアウト' }).click()
  await expect(page).toHaveURL(/\/admin\/login/)
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('eastx:backup:')))).toEqual(
    [],
  )
})

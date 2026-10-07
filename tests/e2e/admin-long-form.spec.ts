/**
 * A5 作品管理・A6 プロジェクト管理・A8 ブログ管理・A9 コーディング記録管理（design-spec 6.6・6.7）。
 * L5 の編集ビュー: 書く → 下書き保存 → プレビューで確認 → 公開 → 公開サイトで確認 → 更新 → 非公開に戻す、
 * 本文への画像の貼り付け、スラッグの自動の生成と追従、使用技術の選択、期限切れからの復元。
 * make e2e のデモデータ（make db-seed）を前提にする。作ったものはテストの中で消す
 */
import type { Locator, Page } from '@playwright/test'
import { eq } from 'drizzle-orm'
import * as schema from '../../src/db/schema'
import { expect, test } from './fixtures'
import { moveUpByKeyboard } from './keyboard-sort'

test.use({ viewport: { width: 1280, height: 900 } })

/** 1×1 の PNG。アップロードは先頭のバイトでも形式を確かめる（SDD 5.10）ので、本物の PNG にする */
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

/** エディタにファイルを貼り付ける（クリップボードの中身はページの中で作る） */
async function pasteFile(editor: Locator, file: { name: string; type: string; base64: string }) {
  await editor.evaluate((element, { name, type, base64 }) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const data = new DataTransfer()
    data.items.add(new File([bytes], name, { type }))
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, file)
}

/** 言語タブの English のパネル。日本語のパネルも同じ名前の欄を持つ */
function englishPanel(page: Page) {
  return page.getByRole('tabpanel', { name: /English/ })
}

/** 操作バーの表示の切り替え（書く｜並べる｜日英｜プレビュー） */
function viewSwitch(page: Page) {
  return page.getByRole('radiogroup', { name: '表示' })
}

/** 表示の切り替えの項目（見た目はアイコンだけ。名前は読み上げの文字とツールチップにある） */
function viewItem(page: Page, name: string) {
  return viewSwitch(page)
    .locator('label')
    .filter({ has: page.getByText(name, { exact: true }) })
}

/** 公開サイトの詳細ページを開いて中身を確かめ、管理画面へ戻る */
async function expectPublicPage(page: Page, path: string, texts: string[]) {
  await page.goto(path)
  for (const text of texts) await expect(page.getByText(text).first()).toBeVisible()
  await page.goBack()
}

test('A5: 書く → 下書き保存 → プレビュー → 公開 → 公開サイト → 更新 → 非公開に戻す → 削除', async ({
  page,
  login,
  local,
}) => {
  await login({ admin: true })
  const stamp = Date.now()
  const newStack = `E2E Stack ${stamp}`
  try {
    await page.goto('/admin/works')
    await page.getByRole('link', { name: '新規作成' }).first().click()
    await expect(page).toHaveURL(/\/admin\/works\/new$/)
    await expect(page.getByText('下書き（未保存）')).toBeVisible()

    // 英語のタイトルからスラッグを作る（design-spec 6.7.2）
    await page.getByLabel('タイトル').first().fill(`E2E 作品 ${stamp}`)
    await page.getByRole('tab', { name: /English/ }).click()
    await englishPanel(page).getByLabel('タイトル').fill(`E2E Work ${stamp}`)
    const slug = page.getByRole('textbox', { name: 'スラッグ' })
    await expect(slug).toHaveValue(`e2e-work-${stamp}`)
    // 英語のタイトルを変えると追従する
    await englishPanel(page).getByLabel('タイトル').fill(`E2E Work ${stamp} v2`)
    await expect(slug).toHaveValue(`e2e-work-${stamp}-v2`)
    // 手で直したら、それ以降は追従しない
    await slug.fill(`e2e-work-${stamp}`)
    await englishPanel(page).getByLabel('タイトル').fill(`E2E Work ${stamp}`)
    await page.waitForTimeout(800)
    await expect(slug).toHaveValue(`e2e-work-${stamp}`)
    await page.getByRole('tab', { name: /日本語/ }).click()

    // 使用技術: 登録済みの技術を検索して選び、候補にない技術はその場で作る
    // 「+ 追加」で検索の欄を出す。選んでも閉じず、Esc で閉じて「+ 追加」に戻る
    const addStack = page.getByRole('button', { name: '追加', exact: true })
    const stackInput = page.getByRole('combobox', { name: '使用技術を検索' })
    await addStack.click()
    await expect(stackInput).toBeFocused()
    const firstOption = page.getByRole('option').first()
    const firstName = (await firstOption.innerText()).trim()
    await firstOption.click()
    await expect(stackInput).toBeVisible()
    await expect(firstOption).toContainText('（選択済み）')
    await stackInput.press('Escape')
    await expect(stackInput).toHaveCount(0)
    await expect(addStack).toBeFocused()
    // 選び済みの技術の名前では「新しい技術として追加」を出さない（同じ技術を二重に作らない）
    await addStack.click()
    await stackInput.fill(firstName)
    await expect(page.getByRole('option', { name: new RegExp(firstName) })).toContainText('（選択済み）')
    await expect(page.getByRole('option', { name: /新しい技術として追加/ })).toHaveCount(0)
    await stackInput.fill(newStack)
    await page.getByRole('option', { name: `「${newStack}」を新しい技術として追加` }).click()
    await stackInput.press('Escape')
    const chips = page.getByRole('list', { name: '選んだ使用技術（並びがトップの行に出る順）' })
    await expect(chips.getByRole('listitem')).toHaveText([firstName, newStack])
    // 並べ替え（キーボード）: 作った技術を先頭へ。横に並べて折り返すので、同じ行なら左、次の行に折り返していれば上の矢印で動かす
    const firstBox = await chips.getByRole('listitem').nth(0).boundingBox()
    const newBox = await chips.getByRole('listitem').nth(1).boundingBox()
    const sameRow = firstBox !== null && newBox !== null && Math.abs(firstBox.y - newBox.y) < firstBox.height / 2
    await moveUpByKeyboard(
      page,
      chips.getByRole('button', { name: `「${newStack}」を並べ替える` }),
      newStack,
      2,
      1,
      sameRow ? 'ArrowLeft' : 'ArrowUp',
    )
    await expect(chips.getByRole('listitem')).toHaveText([newStack, firstName])

    // 本文を書くと、プレビューにすぐ出る
    const editor = page.getByRole('textbox', { name: '詳細本文（日本語）' })
    await editor.fill('## 背景\n\nE2E の本文です。')
    // CodeMirror の基本のスタイルより、トークンの高さとキャレットの色が勝っている（ADR-015）
    const editorStyle = await editor.evaluate((element) => {
      const style = getComputedStyle(element)
      return { minHeight: style.minHeight, caret: style.caretColor, text: getComputedStyle(document.body).color }
    })
    expect(editorStyle.minHeight).toBe('400px')
    expect(editorStyle.caret).toBe(editorStyle.text)
    const preview = page.getByRole('region', { name: 'プレビュー' })
    await expect(preview.getByRole('heading', { name: '背景' })).toBeVisible()

    // 画像を貼り付けると、アップロードして画像の記法を入れる
    await editor.press('Control+End')
    await pasteFile(editor, { name: 'e2e-paste.png', type: 'image/png', base64: PNG_BASE64 })
    await expect(editor).toContainText(/!\[e2e-paste\]\(\/media\/uploads\/[^)]+\.png\)/)
    await expect(editor).not.toContainText('アップロード中…')
    await expect(preview.getByRole('img', { name: 'e2e-paste' })).toBeVisible()
    // 画像でないファイルはアップロードしない
    await pasteFile(editor, { name: 'note.txt', type: 'text/plain', base64: btoa('hello') })
    await expect(page.getByText('画像ファイルではありません')).toBeVisible()

    await page.getByRole('button', { name: '下書き保存' }).click()
    await expect(page.getByText('保存しました')).toBeVisible()
    await expect(page).toHaveURL(/\/admin\/works\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { name: `E2E 作品 ${stamp}` })).toBeVisible()

    await page.getByRole('button', { name: '公開する' }).click()
    await expect(page.getByText('公開しました')).toBeVisible()
    await expectPublicPage(page, `/ja/works/e2e-work-${stamp}`, [`E2E 作品 ${stamp}`, 'E2E の本文です。', newStack])

    // 公開したことがあるもののスラッグを変えると、欄の下と保存のときに確かめる
    await slug.fill(`e2e-work-${stamp}-moved`)
    await expect(page.getByText('今のURLは見られなくなります')).toBeVisible()
    await page.getByRole('button', { name: '更新する' }).click()
    await expect(page.getByRole('dialog')).toContainText('スラッグを変えると、今のURLは見られなくなります')
    await page.getByRole('dialog').getByRole('button', { name: 'キャンセル' }).click()
    await slug.fill(`e2e-work-${stamp}`)
    await expect(page.getByText('今のURLは見られなくなります')).toHaveCount(0)

    await page.getByLabel('概要').first().fill('E2E で更新した概要')
    await editor.fill('## 背景\n\nE2E で更新した本文')
    await page.getByRole('button', { name: '更新する' }).click()
    await expect(page.getByText('更新しました')).toBeVisible()
    await expectPublicPage(page, `/ja/works/e2e-work-${stamp}`, ['E2E で更新した本文'])

    await page.getByRole('button', { name: '非公開に戻す' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '非公開に戻す' }).click()
    await expect(page.getByText('非公開に戻しました')).toBeVisible()
    await expect(page.getByRole('button', { name: '公開する' })).toBeVisible()
    const response = await page.request.get(`/ja/works/e2e-work-${stamp}`)
    expect(response.status()).toBe(404)

    await page.getByRole('button', { name: '削除' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '削除する' }).click()
    await expect(page).toHaveURL(/\/admin\/works$/)
    await expect(page.getByText('削除しました')).toBeVisible()
    await expect(page.getByRole('table', { name: 'Lab の一覧' }).getByText(`E2E 作品 ${stamp}`)).toHaveCount(0)
  } finally {
    await local.db.delete(schema.stack).where(eq(schema.stack.displayName, newStack))
  }
})

test('A5: 本文の画像のアップロードに失敗したら、仮の記法を消して理由を出す', async ({ page, login }) => {
  await login({ admin: true })
  // 応答を遅らせ、アップロード中は保存できないことも確かめる
  let fail: () => void = () => {}
  const responded = new Promise<void>((resolve) => {
    fail = resolve
  })
  await page.route('**/api/admin/uploads', async (route) => {
    await responded
    await route.fulfill({ status: 500, body: 'error' })
  })
  // ダークモードでも、キャレットは CodeMirror のライトの黒ではなく本文の色（ADR-015）
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/admin/works/new')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const editor = page.getByRole('textbox', { name: '詳細本文（日本語）' })
  const colors = await editor.evaluate((element) => ({
    caret: getComputedStyle(element).caretColor,
    text: getComputedStyle(document.body).color,
  }))
  expect(colors.caret).toBe(colors.text)
  expect(colors.caret).not.toBe('rgb(0, 0, 0)')
  await editor.fill('本文')
  await pasteFile(editor, { name: 'fail.png', type: 'image/png', base64: PNG_BASE64 })
  await expect(editor).toContainText('アップロード中…')
  await expect(page.getByRole('button', { name: '下書き保存' })).toBeDisabled()
  fail()
  await expect(page.getByText('アップロードできませんでした')).toBeVisible()
  await expect(page.getByRole('button', { name: '下書き保存' })).toBeEnabled()
  await expect(editor).toHaveText('本文')
})

test('A5: 状態で絞り込んでいるあいだは並べ替えを無効にし、公開中の行から公開サイトへ', async ({ page, login }) => {
  await login({ admin: true })
  await page.goto('/admin/works')
  const table = page.getByRole('table', { name: 'Lab の一覧' })
  await expect(
    table
      .locator('tbody tr')
      .first()
      .getByRole('button', { name: /を並べ替える$/ }),
  ).toBeEnabled()
  // 詳細ページのある公開中の作品は、その詳細ページ（日本語版）へ
  const published = table.getByRole('row').filter({ hasText: '公開' }).filter({ hasText: 'あり' }).first()
  await published.getByRole('button', { name: /の操作$/ }).click()
  await expect(page.getByRole('menuitem', { name: '公開サイトで見る' })).toHaveAttribute('href', /^\/ja\/works\//)
  await page.keyboard.press('Escape')

  await page.getByRole('combobox', { name: '状態' }).click()
  await page.getByRole('option', { name: '公開' }).click()
  await expect(page).toHaveURL(/status=published/)
  await expect(
    table
      .locator('tbody tr')
      .first()
      .getByRole('button', { name: /を並べ替える$/ }),
  ).toBeDisabled()
})

test('A6: 開始年月がないと公開できず、入れると公開でき、期間が一覧に出る', async ({ page, login }) => {
  await login({ admin: true })
  const stamp = Date.now()
  await page.goto('/admin/projects/new')
  await page.getByLabel('タイトル').first().fill(`E2E プロジェクト ${stamp}`)
  await page.getByRole('button', { name: '公開する' }).click()
  const alert = page.getByRole('alert')
  await expect(alert.getByText('公開に必要な項目が足りません')).toBeVisible()
  await expect(alert.getByText('開始年月')).toBeVisible()
  await expect(alert.getByText('スラッグ')).toBeVisible()

  await page.getByRole('textbox', { name: 'スラッグ' }).fill(`e2e-project-${stamp}`)
  await page.getByLabel('開始年月').fill('2024-04')
  await page.getByLabel('終了年月').fill('2024-03')
  await page.getByRole('button', { name: '公開する' }).click()
  await expect(page.getByText('終了年月は開始年月と同じか後にしてください')).toBeVisible()
  await page.getByLabel('終了年月').fill('')
  await page.getByRole('textbox', { name: '詳細本文（日本語）' }).fill('## 経緯\n\nプロジェクトの本文')
  await page.getByRole('button', { name: '公開する' }).click()
  await expect(page.getByText('公開しました')).toBeVisible()
  await expectPublicPage(page, `/ja/projects/e2e-project-${stamp}`, [`E2E プロジェクト ${stamp}`, 'プロジェクトの本文'])

  await page.goto('/admin/projects')
  const table = page.getByRole('table', { name: 'Projects の一覧' })
  const row = table.getByRole('row').filter({ hasText: `E2E プロジェクト ${stamp}` })
  await expect(row).toContainText('2024/04 – 現在')
  await row.getByRole('button', { name: /の操作$/ }).click()
  await page.getByRole('menuitem', { name: '削除' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '削除する' }).click()
  await expect(page.getByText('削除しました')).toBeVisible()
  await expect(row).toHaveCount(0)
})

test('A8: 公開に足りない項目を出し、公開すると公開日が入り、更新・非公開に戻すができる', async ({ page, login }) => {
  await login({ admin: true })
  const stamp = Date.now()
  const title = `E2E ブログ ${stamp}`
  await page.goto('/admin/blog')
  await page.getByRole('link', { name: '新規作成' }).first().click()
  await page.getByLabel('タイトル').first().fill(title)
  await expect(page.getByLabel('公開日')).toBeDisabled()

  // ブログは日英のどちらかでタイトルと本文の両方がいる。足りない言語のタブに印を付ける
  await page.getByRole('button', { name: '公開する' }).click()
  const alert = page.getByRole('alert')
  await expect(alert.getByText('本文（日本語）')).toBeVisible()
  await expect(alert.getByText('スラッグ')).toBeVisible()
  await expect(page.getByRole('tab', { name: /日本語/ })).toContainText('要確認')

  await page.getByRole('textbox', { name: '本文（日本語）' }).fill('# 見出し\n\nブログの本文')
  await page.getByRole('textbox', { name: 'スラッグ' }).fill(`e2e-blog-${stamp}`)
  await page.getByRole('button', { name: '下書き保存' }).click()
  await expect(page.getByText('保存しました')).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/blog\/[0-9a-f-]{36}$/)
  await page.getByRole('button', { name: '公開する' }).click()
  await expect(page.getByText('公開しました')).toBeVisible()
  await expect(page.getByLabel('公開日')).toBeEnabled()
  await expect(page.getByLabel('公開日')).toHaveValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  await expectPublicPage(page, `/ja/blog/e2e-blog-${stamp}`, [title, 'ブログの本文'])

  // 公開日は今より後にできない（design-spec 6.7.3）
  await page.getByLabel('公開日').fill('2999-01-01T00:00')
  await page.getByRole('button', { name: '更新する' }).click()
  await expect(page.getByText('今より後の日時にはできません')).toBeVisible()
  await page.getByLabel('公開日').fill('2026-01-02T09:30')
  await page.getByRole('textbox', { name: '本文（日本語）' }).fill('# 見出し\n\n更新した本文')
  await page.getByRole('button', { name: '更新する' }).click()
  await expect(page.getByText('更新しました')).toBeVisible()
  await expect(page.getByLabel('公開日')).toHaveValue('2026-01-02T09:30')
  await expectPublicPage(page, `/ja/blog/e2e-blog-${stamp}`, ['更新した本文', '2026年1月2日'])

  await page.getByRole('button', { name: '非公開に戻す' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '非公開に戻す' }).click()
  await expect(page.getByText('非公開に戻しました')).toBeVisible()
  // 公開日は消さずに残す（design-spec 6.7.1）
  await expect(page.getByLabel('公開日')).toHaveValue('2026-01-02T09:30')

  await page.goto('/admin/blog?status=draft')
  const row = page.getByRole('table', { name: 'Blog の一覧' }).getByRole('row').filter({ hasText: title })
  await expect(row).toContainText('2026/01/02')
  await row.getByRole('button', { name: /の操作$/ }).click()
  await page.getByRole('menuitem', { name: '削除' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '削除する' }).click()
  await expect(page.getByText('削除しました')).toBeVisible()
  await expect(row).toHaveCount(0)
})

test('A9: 種類・参考リンクを入れて公開し、種類で絞り込める', async ({ page, login }) => {
  await login({ admin: true })
  const stamp = Date.now()
  const title = `E2E Coding ${stamp}`
  await page.goto('/admin/coding/new')
  await page.getByRole('combobox', { name: '種類' }).click()
  await page.getByRole('option', { name: '問題を解いた記録' }).click()
  await page.getByLabel('参考リンク').fill('https://example.com/problem')
  await page.getByRole('tab', { name: /English/ }).click()
  await englishPanel(page).getByLabel('タイトル').fill(title)
  await expect(page.getByRole('textbox', { name: 'スラッグ' })).toHaveValue(`e2e-coding-${stamp}`)
  // 本文のエディタとプレビューは、選んでいる言語のものに切り替わる
  await page.getByRole('textbox', { name: '本文（英語）' }).fill('```ts\nconst answer = 42\n```')
  await expect(page.getByRole('region', { name: 'プレビュー' }).getByText('const answer = 42')).toBeVisible()
  await page.getByRole('button', { name: '公開する' }).click()
  await expect(page.getByText('公開しました')).toBeVisible()
  await expectPublicPage(page, `/en/coding/e2e-coding-${stamp}`, [title, 'Problem Solving', 'const answer = 42'])

  await page.goto('/admin/coding?kind=problem')
  const table = page.getByRole('table', { name: 'Coding Log の一覧' })
  const row = table.getByRole('row').filter({ hasText: title })
  await expect(row).toContainText('問題を解いた記録')
  await row.getByRole('button', { name: /の操作$/ }).click()
  await expect(page.getByRole('menuitem', { name: '公開サイトで見る' })).toHaveAttribute(
    'href',
    `/ja/coding/e2e-coding-${stamp}`,
  )
  await page.getByRole('menuitem', { name: '削除' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '削除する' }).click()
  await expect(page.getByText('削除しました')).toBeVisible()
  await expect(row).toHaveCount(0)
})

test('L5: 期限切れの一時保存から本文も復元し、保存していない変更は移る前に確かめる', async ({
  page,
  context,
  login,
}) => {
  await login({ admin: true })
  await page.goto('/admin/blog/new')
  await page.getByLabel('タイトル').first().fill('期限切れの前に書いた記事')
  await page.getByRole('textbox', { name: '本文（日本語）' }).fill('期限切れの前に書いた本文')

  const nav = page.getByRole('navigation', { name: '管理メニュー' })
  await nav.getByRole('link', { name: 'Lab' }).click()
  await expect(page.getByRole('dialog')).toContainText('保存していない変更があります。移動しますか？')
  await page.getByRole('dialog').getByRole('button', { name: 'キャンセル' }).click()

  await context.clearCookies()
  await page.getByRole('button', { name: '下書き保存' }).click()
  await expect(page).toHaveURL(/\/admin\/login\?redirect=%2Fadmin%2Fblog%2Fnew$/)

  await login({ admin: true })
  await page.goto('/admin/blog/new')
  await page.getByRole('button', { name: '復元する' }).click()
  await expect(page.getByLabel('タイトル').first()).toHaveValue('期限切れの前に書いた記事')
  await expect(page.getByRole('textbox', { name: '本文（日本語）' })).toHaveText('期限切れの前に書いた本文')
  await expect(page.getByRole('region', { name: 'プレビュー' })).toContainText('期限切れの前に書いた本文')
})

/** `pattern` への要求を、返してよいと言われるまで止める */
async function holdRequests(page: Page, pattern: string, method: string) {
  let release: () => void = () => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(pattern, async (route) => {
    if (route.request().method() !== method) return route.continue()
    await released
    await route.continue()
  })
  return release
}

test('L5: 新規作成の初めての保存を待つあいだに書いた本文は、保存のあとも残る', async ({ page, login }) => {
  await login({ admin: true })
  const stamp = Date.now()
  await page.goto('/admin/blog/new')
  await page.getByLabel('タイトル').first().fill(`E2E 保存中 ${stamp}`)
  const editor = page.getByRole('textbox', { name: '本文（日本語）' })
  await editor.fill('保存した本文')
  const release = await holdRequests(page, '**/api/admin/blog-posts', 'POST')
  await page.getByRole('button', { name: '下書き保存' }).click()
  await expect(page.getByRole('button', { name: '保存中…' })).toBeVisible()
  await editor.press('Control+End')
  await page.keyboard.type('と続き')
  await expect(editor).toHaveText('保存した本文と続き')
  release()
  await expect(page.getByText('保存しました')).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/blog\/[0-9a-f-]{36}$/)
  await expect(editor).toHaveText('保存した本文と続き')

  // 後片付け（続きは保存していないので、移る前の確認を通して削除する）
  await page.getByRole('button', { name: '削除' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '削除する' }).click()
  await expect(page).toHaveURL(/\/admin\/blog$/)
})

test('L5: アップロードのあいだに画面の幅がモバイルに変わっても、画像の記法が入る', async ({ page, login }) => {
  await login({ admin: true })
  await page.goto('/admin/works/new')
  const editor = page.getByRole('textbox', { name: '詳細本文（日本語）' })
  await editor.fill('本文')
  await editor.press('Control+End')
  const release = await holdRequests(page, '**/api/admin/uploads', 'POST')
  await pasteFile(editor, { name: 'resize.png', type: 'image/png', base64: PNG_BASE64 })
  await expect(editor).toContainText('アップロード中…')
  await page.setViewportSize({ width: 375, height: 800 })
  await expect(viewItem(page, '書く')).toBeVisible()
  await expect(page.getByRole('button', { name: '下書き保存' })).toBeDisabled()
  release()
  await expect(editor).toContainText(/!\[resize\]\(\/media\/uploads\/[^)]+\.png\)/)
  await expect(page.getByRole('button', { name: '下書き保存' })).toBeEnabled()
})

test.describe('モバイル幅（<768px）', () => {
  test.use({ viewport: { width: 375, height: 800 } })

  test('L5 は「書く｜プレビュー｜日英」で切り替え、「並べる」は出さない', async ({ page, login }) => {
    await login({ admin: true })
    await page.goto('/admin/works/new')
    const editor = page.getByRole('textbox', { name: '詳細本文（日本語）' })
    await editor.fill('## モバイルの見出し')
    await expect(viewItem(page, '並べる')).toHaveCount(0)
    await viewItem(page, 'プレビュー').click()
    await expect(page.getByRole('heading', { name: 'モバイルの見出し' })).toBeVisible()
    await expect(editor).toBeHidden()
    await viewItem(page, '書く').click()
    await expect(editor).toHaveText('## モバイルの見出し')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})

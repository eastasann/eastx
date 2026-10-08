/**
 * A2 ダッシュボード・A3 プロフィール・A7 使用技術と、管理画面の共通の仕組み（design-spec 6.4〜6.7）:
 * 存在しない管理画面の URL の通知、保存していない変更の確認、ログインの期限切れの一時保存と復元。
 * make e2e のデモデータ（make db-seed）を前提にする。デモデータを書き換えたものは、テストの中で元に戻す
 */
import { eq } from 'drizzle-orm'
import { buildSeed } from '../../scripts/seed/data'
import { insertSeed } from '../../scripts/seed/insert'
import * as schema from '../../src/db/schema'
import { expect, test } from './fixtures'
import { moveUpByKeyboard } from './keyboard-sort'

test.use({ viewport: { width: 1280, height: 900 } })

test('A2: 件数カード・下書きの一覧を出し、下書きの件数から絞り込んだ一覧へ', async ({ page, login }) => {
  await login({ admin: true })
  await page.goto('/admin')
  const cards = page.getByRole('list', { name: '種類ごとの件数' })
  await expect(cards.getByRole('listitem')).toHaveCount(6)
  await expect(cards.getByRole('listitem').filter({ hasText: 'Tech Stack' })).toContainText('件')
  const drafts = page.getByRole('region', { name: '下書き' })
  await expect(drafts.getByRole('row').nth(1)).toBeVisible()
  await expect(page.getByRole('link', { name: /公開サイトを見る/ })).toHaveAttribute('target', '_blank')

  // カードのどこを押しても一覧へ移る
  await cards.getByRole('listitem').filter({ hasText: 'Tech Stack' }).click()
  await expect(page).toHaveURL(/\/admin\/stacks$/)
  await page.goBack()

  await cards
    .getByRole('listitem')
    .filter({ hasText: 'Career' })
    .getByRole('link', { name: /下書き/ })
    .click()
  await expect(page).toHaveURL(/\/admin\/careers\?status=draft$/)
  await expect(page.getByRole('combobox', { name: '状態' })).toHaveText(/下書き/)
})

test('存在しない管理画面の URL はダッシュボードへ移し、通知する', async ({ page, login }) => {
  await login({ admin: true })
  await page.goto('/admin/no-such-page')
  await expect(page).toHaveURL(/\/admin$/)
  await expect(page.getByText('ページが見つかりませんでした')).toBeVisible()
})

test('存在しない ID の編集ビューは「見つかりませんでした」と「一覧へ戻る」', async ({ page, login }) => {
  await login({ admin: true })
  await page.goto('/admin/careers/00000000-0000-4000-8000-000000000000')
  await expect(page.getByText('見つかりませんでした')).toBeVisible()
  await page.getByRole('link', { name: '一覧へ戻る' }).click()
  await expect(page).toHaveURL(/\/admin\/careers$/)
})

test('保存していない変更があれば、移る前に確認する', async ({ page, login }) => {
  await login({ admin: true })
  await page.goto('/admin/careers/new')
  await page.getByLabel('タイトル').first().fill('書きかけ')
  const nav = page.getByRole('navigation', { name: '管理メニュー' })
  await nav.getByRole('link', { name: 'Tech Stack' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('保存していない変更があります。移動しますか？')
  await dialog.getByRole('button', { name: 'キャンセル' }).click()
  await expect(page).toHaveURL(/\/admin\/careers\/new$/)
  await expect(page.getByLabel('タイトル').first()).toHaveValue('書きかけ')

  await nav.getByRole('link', { name: 'Tech Stack' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '移動する' }).click()
  await expect(page).toHaveURL(/\/admin\/stacks$/)
})

test('ログインの期限が切れたら一時保存して A1 へ移し、ログインし直すと復元できる', async ({ page, context, login }) => {
  await login({ admin: true })
  await page.goto('/admin/careers/new')
  await page.getByLabel('タイトル').first().fill('期限切れの前に書いた')
  await page.getByLabel('場所').first().fill('東京')

  // セッションの Cookie を消すと、次の API の呼び出しは期限切れと同じ UNAUTHORIZED になる
  await context.clearCookies()
  await page.getByRole('button', { name: '下書き保存' }).click()
  await expect(
    page.getByText('ログインの有効期限が切れました。入力中の内容はこのブラウザに一時保存してあります'),
  ).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/login\?redirect=%2Fadmin%2Fcareers%2Fnew$/)

  await login({ admin: true })
  await page.goto('/admin/careers/new')
  await expect(page.getByText('一時保存した内容があります')).toBeVisible()
  await expect(page.getByLabel('タイトル').first()).toHaveValue('')
  await page.getByRole('button', { name: '復元する' }).click()
  await expect(page.getByLabel('タイトル').first()).toHaveValue('期限切れの前に書いた')
  await expect(page.getByLabel('場所').first()).toHaveValue('東京')
  await expect(page.getByText('一時保存した内容があります')).toHaveCount(0)

  // 一時保存は保存するか破棄するまで残る。破棄すると次に開いたときは出ない
  await page.reload()
  await expect(page.getByText('一時保存した内容があります')).toBeVisible()
  await page.getByRole('button', { name: '破棄する' }).click()
  await page.reload()
  await expect(page.getByLabel('タイトル').first()).toBeVisible()
  await expect(page.getByText('一時保存した内容があります')).toHaveCount(0)
})

test('A7: 作成・保存・キーボードでの並べ替え・使っている数を出す削除', async ({ page, login }) => {
  await login({ admin: true })
  await page.goto('/admin/stacks/new')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('表示名を入力してください')).toBeVisible()

  const name = `E2E Tech ${Date.now()}`
  await page.getByLabel('表示名').fill(name)
  await page.getByLabel('識別名').fill('react')
  await page.getByLabel('リンク').fill('http://example.com')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('https:// で始めてください')).toBeVisible()
  await page.getByLabel('リンク').fill('https://example.com')
  await page.getByRole('button', { name: '保存' }).click()
  // 識別名の重複は候補を添えて欄の下に出す
  await expect(page.getByText(/この識別名はすでに使われています（候補: react-2）/)).toBeVisible()
  await page.getByLabel('識別名').fill(`e2e-tech-${Date.now()}`)
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('保存しました')).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/stacks\/[0-9a-f-]{36}$/)

  // 保存したものを編集して保存し直す
  await page.getByLabel('表示名').fill(`${name} v2`)
  const showOnTop = page.getByRole('checkbox', { name: 'トップに表示する' })
  await expect(showOnTop).toBeChecked()
  await page.getByText('トップに表示する', { exact: true }).click()
  await expect(showOnTop).not.toBeChecked()
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('保存しました').last()).toBeVisible()
  await expect(page.getByRole('heading', { name: `${name} v2` })).toBeVisible()
  await page.getByLabel('表示名').fill(name)
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()

  // 新規作成は末尾に入る。キーボードで先頭の1つ下まで上げ、保存されたことを読み直して確かめる
  await page.goto('/admin/stacks')
  const table = page.getByRole('table', { name: 'Tech Stack の一覧' })
  const names = table.locator('tbody td:nth-child(3)')
  await expect(names.last()).toHaveText(name)
  const count = await names.count()
  await moveUpByKeyboard(page, table.getByRole('button', { name: `「${name}」を並べ替える` }), name, count, 2)
  await expect(page.getByText('表示順を保存しました')).toBeVisible()
  await page.reload()
  await expect(names.nth(1)).toHaveText(name)

  await table.getByRole('button', { name: `「${name}」の操作` }).click()
  await page.getByRole('menuitem', { name: '削除' }).click()
  await expect(page.getByRole('dialog')).toContainText(`『${name}』を削除します。元に戻せません`)
  await page.getByRole('dialog').getByRole('button', { name: '削除する' }).click()
  await expect(page.getByText('削除しました')).toBeVisible()
  await expect(names.filter({ hasText: name })).toHaveCount(0)

  // 使っている作品・プロジェクトのある技術は、その数を確認に出す（削除はしない）
  const used = table
    .getByRole('row')
    .filter({ hasText: /[1-9]\d*件/ })
    .first()
  const usedName = (await used.locator('td:nth-child(3)').innerText()).trim()
  await used.getByRole('button', { name: `「${usedName}」の操作` }).click()
  await page.getByRole('menuitem', { name: '削除' }).click()
  await expect(page.getByRole('dialog')).toContainText(/使っている Projects・Lab \d+件の紐づけも外れます/)
  await page.getByRole('dialog').getByRole('button', { name: 'キャンセル' }).click()
})

test('A7: カテゴリと Core の列、カテゴリと Core を変えて保存すると P1 の群が移る', async ({ page, login, local }) => {
  await login({ admin: true })
  try {
    await page.goto('/admin/stacks')
    const table = page.getByRole('table', { name: 'Tech Stack の一覧' })
    await expect(table.getByRole('columnheader', { name: 'カテゴリ' })).toBeVisible()
    await expect(table.getByRole('columnheader', { name: 'Core', exact: true })).toBeVisible()
    const typescript = table.getByRole('row').filter({ hasText: 'TypeScript' })
    await expect(typescript.getByRole('cell', { name: 'Languages' })).toBeVisible()
    await expect(typescript.getByRole('cell', { name: 'Core', exact: true })).toBeVisible()

    // カテゴリを変えると、P1 の群が移る
    await table.getByRole('link', { name: 'Go', exact: true }).click()
    await page.getByRole('combobox', { name: 'カテゴリ' }).click()
    await page.getByRole('option', { name: 'Tools' }).click()
    await page.getByRole('button', { name: '保存' }).click()
    await expect(page.getByText('保存しました').last()).toBeVisible()
    await page.goto('/ja')
    const stackSection = page.locator('#stack')
    await expect(stackSection.getByRole('list', { name: 'Tools' }).getByText('Go', { exact: true })).toBeVisible()
    await expect(stackSection.getByRole('list', { name: 'Languages' }).getByText('Go', { exact: true })).toHaveCount(0)

    // Core をオンにすると「トップに表示する」がオンで押せなくなり、保存すると Core の群に出る
    await page.goBack()
    const showOnTop = page.getByRole('checkbox', { name: 'トップに表示する' })
    await page.getByText('トップに表示する', { exact: true }).click()
    await expect(showOnTop).not.toBeChecked()
    await page.getByText('Core', { exact: true }).click()
    await expect(page.getByRole('checkbox', { name: 'Core' })).toBeChecked()
    await expect(showOnTop).toBeChecked()
    await expect(showOnTop).toBeDisabled()
    await expect(page.getByText('Core の技術はトップに表示します')).toBeVisible()
    await page.getByRole('button', { name: '保存' }).click()
    await expect(page.getByText('保存しました').last()).toBeVisible()
    await page.goto('/ja')
    await expect(stackSection.getByRole('list', { name: 'Core' }).getByText('Go', { exact: true })).toBeVisible()
    await expect(stackSection.getByRole('list', { name: 'Tools' }).getByText('Go', { exact: true })).toHaveCount(0)

    // 古いコードが作りうる「Core かつトップに表示しない」値は、黙って直さず、保存すると欄の下に誤りを出す
    await local.db.update(schema.stack).set({ isCore: true, showOnTop: false }).where(eq(schema.stack.key, 'python'))
    await page.goto('/admin/stacks')
    await table.getByRole('link', { name: 'Python', exact: true }).click()
    await expect(page.getByRole('checkbox', { name: 'Core' })).toBeChecked()
    await expect(showOnTop).not.toBeChecked()
    await expect(showOnTop).toBeEnabled()
    await page.getByRole('button', { name: '保存' }).click()
    await expect(page.locator('[data-field="showOnTop"]').getByText('Core の技術はトップに表示します')).toBeVisible()
    await expect(showOnTop).toBeFocused()
  } finally {
    await insertSeed(local.db, buildSeed({ empty: false }))
  }
})

test('A3: 自己紹介のプレビュー、SNSリンクの追加・並べ替え・削除、保存が公開サイトに出る', async ({ page, login }) => {
  await login({ admin: true })
  await page.goto('/admin/profile')
  const headline = page.getByLabel('肩書き').first()
  await expect(headline).not.toHaveValue('')
  const original = await headline.inputValue()

  await page.getByRole('button', { name: 'プレビュー' }).first().click()
  const preview = page.getByRole('region', { name: '自己紹介のプレビュー' }).first()
  await expect(preview).not.toContainText('準備しています', { timeout: 15_000 })
  // 太字が使用技術と一致すれば技術アイコンが付き（公開側の P1 と同じ描画。ADR-012）、一致しない太字には付かない
  await expect(preview.locator('img[data-stack-icon] + strong')).toHaveText(['React', 'TypeScript'])
  await expect(preview.getByText('使いやすさ')).toBeVisible()
  await page.getByRole('button', { name: '入力に戻る' }).first().click()

  const links = page.getByRole('list', { name: 'SNSリンクの並び' })
  const before = await links.getByRole('listitem').count()
  await page.getByRole('button', { name: 'SNSリンクを追加' }).click()
  const added = links.getByRole('listitem').last()
  await added.getByRole('combobox', { name: 'サービス' }).click()
  await page.getByRole('option', { name: 'その他' }).click()
  await added.getByLabel('URL').fill('https://example.com/e2e')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(added.getByText('表示名を入力してください')).toBeVisible()
  await added.getByLabel('表示名').fill('E2E Link')
  await headline.fill(`${original} (E2E)`)
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('保存しました')).toBeVisible()

  await page.goto('/ja')
  await expect(page.getByText(`${original} (E2E)`).first()).toBeVisible()
  await expect(page.getByRole('link', { name: /E2E Link/ }).first()).toBeVisible()

  // 元に戻す: 追加したリンクを先頭へ動かしてから削除し、肩書きを戻す
  await page.goto('/admin/profile')
  await expect(links.getByRole('listitem')).toHaveCount(before + 1)
  const addedName = `その他（${before + 1}番目）`
  await moveUpByKeyboard(
    page,
    links.getByRole('button', { name: `「${addedName}」を並べ替える` }),
    addedName,
    before + 1,
    1,
  )
  await expect(links.getByRole('listitem').first().getByLabel('表示名')).toHaveValue('E2E Link')
  await links.getByRole('button', { name: '「その他（1番目）」を削除' }).click()
  await page.getByLabel('肩書き').first().fill(original)
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('保存しました')).toBeVisible()
  await expect(links.getByRole('listitem')).toHaveCount(before)
})

test('A3: 一言を入力して保存すると、P1 のプロフィールの上に出る', async ({ page, login }) => {
  await login({ admin: true })
  await page.goto('/admin/profile')
  const name = await page.getByLabel('名前').first().inputValue()
  const tagline = page.getByLabel('一言').first()
  const original = await tagline.inputValue()
  const value = `${original} E2E の一言`
  await tagline.fill(value)
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('保存しました')).toBeVisible()

  await page.goto('/ja')
  const shown = page.locator('#profile').getByText(value, { exact: true })
  await expect(shown).toBeVisible()
  const shownBox = await shown.boundingBox()
  const nameBox = await page.getByRole('heading', { level: 1, name }).boundingBox()
  if (!shownBox || !nameBox) throw new Error('一言か名前が見えない')
  expect(shownBox.y + shownBox.height).toBeLessThanOrEqual(nameBox.y)

  await page.goto('/admin/profile')
  await page.getByLabel('一言').first().fill(original)
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('保存しました')).toBeVisible()
})

test('失敗の表示: 一覧の取得・並べ替えの保存・保存（design-spec 6.6・6.7.4）', async ({ page, login }) => {
  await login({ admin: true })

  // 取得に失敗 → 「読み込めませんでした」と「再試行」
  let failList = true
  await page.route('**/api/admin/stacks', (route) =>
    failList ? route.fulfill({ status: 503, body: 'unavailable' }) : route.continue(),
  )
  await page.goto('/admin/stacks')
  await expect(page.getByText('読み込めませんでした')).toBeVisible()
  failList = false
  await page.getByRole('button', { name: '再試行' }).click()
  const table = page.getByRole('table', { name: 'Tech Stack の一覧' })
  const names = table.locator('tbody td:nth-child(3)')
  await expect(names.first()).toBeVisible()

  // 並べ替えの保存に失敗 → 並びを元に戻して通知
  const order = await names.allInnerTexts()
  await page.route('**/api/admin/stacks/reorder', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        defined: true,
        code: 'ORDER_OUT_OF_DATE',
        status: 409,
        message: '表示順が最新ではありません',
      }),
    }),
  )
  const second = order[1] ?? ''
  await moveUpByKeyboard(page, table.getByRole('button', { name: `「${second}」を並べ替える` }), second, 2, 1)
  await expect(page.getByText('表示順を保存できませんでした')).toBeVisible()
  await expect(names).toHaveText(order)

  // 保存に失敗 → 通知し、入力は消さない
  await page.route('**/api/admin/stacks/*', (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 500, body: 'error' }) : route.continue(),
  )
  await table.getByRole('link', { name: order[0] ?? '' }).click()
  await page.getByLabel('表示名').fill('保存できない名前')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('保存できませんでした。もう一度お試しください')).toBeVisible()
  await expect(page.getByLabel('表示名')).toHaveValue('保存できない名前')
})

test('A3: プロフィールがまだなければ空のフォームを出し、初めて保存したときに作る', async ({ page, login, local }) => {
  await login({ admin: true })
  // デモデータのプロフィールを外しておき、終わったら元の行に戻す
  const profiles = await local.db.select().from(schema.profile)
  const links = await local.db.select().from(schema.socialLink)
  await local.db.delete(schema.socialLink)
  await local.db.delete(schema.profile)
  try {
    await page.goto('/admin/profile')
    await expect(page.getByLabel('名前').first()).toHaveValue('')
    await expect(page.getByRole('list', { name: 'SNSリンクの並び' }).getByRole('listitem')).toHaveCount(0)
    await page.getByRole('button', { name: '保存' }).click()
    await expect(page.getByText('名前を日本語か英語のどちらかに入力してください').first()).toBeVisible()
    await page.getByLabel('名前').first().fill('E2E 太郎')
    await page.getByRole('button', { name: '保存' }).click()
    await expect(page.getByText('保存しました')).toBeVisible()
    await page.reload()
    await expect(page.getByLabel('名前').first()).toHaveValue('E2E 太郎')
  } finally {
    await local.db.delete(schema.socialLink)
    await local.db.delete(schema.profile)
    for (const row of profiles) await local.db.insert(schema.profile).values(row)
    for (const row of links) await local.db.insert(schema.socialLink).values(row)
  }
})

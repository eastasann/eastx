/**
 * 受入スイート: design-spec 2.2 のコアフローを1本ずつと、異常系の最低ライン（SDD 10章）。
 * 実装の内部（クラス名・DOM の形・API）ではなく、画面に出る文言と役割（ロール）で仕様の振る舞いを確かめる。
 * make e2e のデモデータ（make db-seed）を前提にする。作ったものはテストの中で消す
 */
import { buildSeed } from '../../scripts/seed/data'
import { insertSeed } from '../../scripts/seed/insert'
import { expect, test } from './fixtures'
import { gotoHydrated } from './hydration'
import { moveUpByKeyboard } from './keyboard-sort'
import { expandRow, rowButton } from './top-rows'

test.describe('訪問者', () => {
  test.use({ locale: 'ja-JP' })

  test('何者かつかみ、作品で確かめる: トップ → セクション内ページング → 詳細 → 実物へ → 戻るで元のページ → 言語の切り替え', async ({
    page,
  }) => {
    // トップを開く（言語の振り分けで /ja） → プロフィールと経歴で要点をつかむ
    await gotoHydrated(page, '/')
    await expect(page).toHaveURL('/ja')
    const profile = page.locator('#profile')
    await expect(profile.getByRole('heading', { level: 1, name: '東 アジア' })).toBeVisible()
    await expect(profile.getByText('ソフトウェアエンジニア').first()).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Career' })).toBeVisible()
    await expect(page.locator('#career').getByText('シニアエンジニア')).toBeVisible()

    // プロジェクト欄（10件以下なのでページングなし）の行を広げて中身を見て、広げた中の入口からプロジェクト詳細へ → 戻る
    const project = await expandRow(page, 'projects', '決済基盤の刷新')
    await expect(project.getByRole('img', { name: '決済基盤の刷新' })).toBeVisible()
    await project.getByRole('link', { name: '詳細を見る' }).click()
    await expect(page).toHaveURL('/ja/projects/payment-renewal')
    await expect(page.getByRole('heading', { level: 1, name: '決済基盤の刷新' })).toBeVisible()
    await page.getByRole('link', { name: 'Projects へ戻る' }).click()
    await expect(page).toHaveURL('/ja#projects')
    await expect(rowButton(page, 'projects', '決済基盤の刷新')).toBeVisible()

    // 作品欄をページングして作品詳細へ → 戻るで元のページ（2ページ目）
    const works = page.locator('#works')
    const workPaging = works.getByRole('group', { name: 'Lab のページ' })
    await workPaging.getByRole('button', { name: '次のページ' }).click()
    await expect(workPaging).toContainText('2 / 2')
    await (await expandRow(page, 'works', 'レシピノート')).getByRole('link', { name: '詳細を見る' }).click()
    await expect(page).toHaveURL('/ja/works/recipe-notes')
    await expect(page.getByRole('heading', { level: 1, name: 'レシピノート' })).toBeVisible()
    await page.getByRole('link', { name: 'Lab へ戻る' }).click()
    await expect(page).toHaveURL('/ja#works')
    await expect(workPaging).toContainText('2 / 2')

    // 前後のナビで別の作品へ → 外部リンクで実物を確かめる（別タブ）
    await (await expandRow(page, 'works', 'レシピノート')).getByRole('link', { name: '詳細を見る' }).click()
    await page.getByRole('navigation', { name: '前後のページ' }).getByRole('link').click()
    await expect(page).toHaveURL('/ja/works/budget-app')
    await expect(page.getByRole('heading', { level: 1, name: '家計簿アプリ' })).toBeVisible()
    const visit = page.getByRole('main').getByRole('link', { name: /サイトを見る/ })
    await expect(visit).toHaveAttribute('href', 'https://example.com/budget')
    await expect(visit).toHaveAttribute('target', '_blank')
    await expect(visit).toHaveAttribute('rel', /noopener/)
    // 戻るリンクは、いま見ている作品を含むページを開く
    await page.getByRole('link', { name: 'Lab へ戻る' }).click()
    await expect(workPaging).toContainText('1 / 2')
    await expect(rowButton(page, 'works', '家計簿アプリ')).toBeVisible()

    // 言語を切り替えると、同じ画面の英語版になる
    await page.getByRole('group', { name: '言語' }).getByRole('link', { name: 'EN' }).click()
    await expect(page).toHaveURL(/\/en(#works)?$/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('heading', { level: 2, name: 'Career' })).toBeVisible()
  })

  test('詳細のない作品は、トップの行を広げた中の外部リンク・GitHub へ進む', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    const landing = (await expandRow(page, 'works', 'ランディングページ')).getByRole('link', { name: /サイトを見る/ })
    await expect(landing).toHaveAttribute('href', 'https://example.com/landing')
    await expect(landing).toHaveAttribute('target', '_blank')
    const response = await page.request.get('/ja/works/landing-page')
    expect(response.status()).toBe(404)
  })

  test('人となりを知る: ブログ欄をページング → 記事を読む → トップのブログ欄へ戻る', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    const blog = page.locator('#blog')
    const paging = blog.getByRole('group', { name: 'Blog のページ' })
    await expect(paging).toContainText('1 /')
    await paging.getByRole('button', { name: '次のページ' }).click()
    await expect(paging).toContainText('2 /')

    // ほかのページの行は操作できない（inert）まま DOM に残るので、今のページから選ぶ
    const post = blog.locator('ul:not([inert])').getByRole('article').first().getByRole('link').first()
    const title = (await post.innerText()).trim()
    await post.click()
    await expect(page).toHaveURL(/\/ja\/blog\/[a-z0-9-]+$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)

    await page.getByRole('link', { name: 'Blog へ戻る' }).click()
    await expect(page).toHaveURL('/ja#blog')
    await expect(paging).toContainText('2 /')
    await expect(blog.getByRole('link', { name: title })).toBeVisible()

    // コーディング記録も同じ流れで読める
    const log = page.locator('#coding ul:not([inert])').getByRole('article').first().getByRole('link').first()
    await log.click()
    await expect(page).toHaveURL(/\/ja\/coding\/[a-z0-9-]+$/)
    await page.getByRole('link', { name: 'Coding Log へ戻る' }).click()
    await expect(page).toHaveURL('/ja#coding')
  })
})

test.describe('管理者', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('書いて公開する: ダッシュボード → 作品の一覧 → 新規作成 → 下書き保存 → プレビュー → 公開 → 公開サイトで確認 → 並べ替え', async ({
    page,
    login,
  }) => {
    // GitHub でのログインはフィクスチャのセッションで代える（SDD 10章）
    await login({ admin: true })
    const stamp = Date.now()
    const title = `受入 ${stamp}`
    const slug = `acceptance-${stamp}`

    await page.goto('/admin')
    await expect(page.getByRole('heading', { level: 1, name: 'ダッシュボード' })).toBeVisible()
    await page.getByRole('navigation').getByRole('link', { name: 'Lab' }).click()
    await expect(page).toHaveURL('/admin/works')
    await page.getByRole('link', { name: '新規作成' }).first().click()
    await expect(page).toHaveURL('/admin/works/new')

    await page.getByLabel('タイトル').first().fill(title)
    await page.getByRole('tab', { name: /English/ }).click()
    await page
      .getByRole('tabpanel', { name: /English/ })
      .getByLabel('タイトル')
      .fill(`Acceptance ${stamp}`)
    await page.getByRole('tab', { name: /日本語/ }).click()
    await page.getByRole('textbox', { name: 'スラッグ' }).fill(slug)
    await page.getByRole('textbox', { name: '詳細本文（日本語）' }).fill('## 受入\n\n受入テストの本文です。')

    await page.getByRole('button', { name: '下書き保存' }).click()
    await expect(page.getByText('保存しました')).toBeVisible()
    await expect(page).toHaveURL(/\/admin\/works\/[0-9a-f-]{36}$/)
    // 下書きはまだ公開サイトに出ない
    expect((await page.request.get(`/ja/works/${slug}`)).status()).toBe(404)

    const preview = page.getByRole('region', { name: 'プレビュー' })
    await expect(preview.getByRole('heading', { name: '受入' })).toBeVisible()
    await expect(preview.getByText('受入テストの本文です。')).toBeVisible()

    const table = page.getByRole('table', { name: 'Lab の一覧' })
    try {
      await page.getByRole('button', { name: '公開する' }).click()
      await expect(page.getByText('公開しました')).toBeVisible()

      // 公開サイトで確認（デプロイなしで、保存した瞬間に反映される）
      await page.goto(`/ja/works/${slug}`)
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
      await expect(page.getByText('受入テストの本文です。')).toBeVisible()

      // 新規作成は先頭に入る（design-spec 6.7.2）ので、トップの作品欄の先頭に出る。行のボタンの読み上げ名はタイトル
      const firstWork = page.locator('#works').getByRole('article').first().getByRole('button')
      await page.goto('/ja')
      await expect(firstWork).toHaveAccessibleName(title)

      // 並べ替え: 一覧で2番目の作品を先頭へ動かすと、トップの作品欄の先頭がその作品になる
      await page.goto('/admin/works')
      const rows = table.locator('tbody tr')
      await expect(rows.first()).toContainText(title)
      const second =
        (await table
          .getByRole('button', { name: /を並べ替える$/ })
          .nth(1)
          .getAttribute('aria-label')) ?? ''
      const secondTitle = second.replace(/^「(.*)」を並べ替える$/, '$1')
      await moveUpByKeyboard(page, table.getByRole('button', { name: second }), secondTitle, 2, 1)
      await expect(page.getByText('表示順を保存しました')).toBeVisible()
      await page.goto('/ja')
      await expect(firstWork).toHaveAccessibleName(secondTitle)
    } finally {
      await page.goto('/admin/works')
      await table.getByRole('button', { name: `「${title}」の操作` }).click()
      await page.getByRole('menuitem', { name: '削除' }).click()
      await page.getByRole('dialog').getByRole('button', { name: '削除する' }).click()
      await expect(page.getByText('削除しました')).toBeVisible()
    }
  })
})

test.describe('異常系の最低ライン', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('不正な入力: 欄の下にエラーを出し、保存しない', async ({ page, login }) => {
    await login({ admin: true })
    await page.goto('/admin/blog/new')
    await page.getByRole('textbox', { name: 'スラッグ' }).fill('Not A Slug')
    await page.getByRole('button', { name: '下書き保存' }).click()
    await expect(page.getByText('タイトルを日本語か英語のどちらかに入力してください').first()).toBeVisible()
    await expect(page).toHaveURL('/admin/blog/new')
  })

  test('未認証の拒否: 管理画面は A1 へ、CMS API は 401', async ({ page }) => {
    await page.goto('/admin/blog')
    await expect(page).toHaveURL('/admin/login?redirect=%2Fadmin%2Fblog')
    const response = await page.request.get('/api/admin/dashboard', { headers: { 'x-csrf-token': 'orpc' } })
    expect(response.status()).toBe(401)
  })

  test('管理者でないセッション: A1 の「管理者でないアカウント」へ移る（SDD 7章）', async ({ page, login }) => {
    await login()
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/admin\/login\?.*error=forbidden/)
    await expect(page.getByRole('status')).toHaveText('このアカウントでは管理画面に入れません')
  })

  test.describe('空の状態', () => {
    test.afterEach(async ({ local }) => {
      await insertSeed(local.db, buildSeed({ empty: false }))
    })

    test('0件のセクションは公開サイトから消え、管理画面の一覧は「まだありません」', async ({ page, login, local }) => {
      await insertSeed(local.db, buildSeed({ empty: true }))
      await page.goto('/ja')
      await expect(page.locator('#works')).toBeVisible()
      await expect(page.locator('#blog')).toHaveCount(0)

      await login({ admin: true })
      await page.goto('/admin/blog')
      await expect(page.getByText('まだありません。「新規作成」から追加できます')).toBeVisible()
    })
  })

  test('期限切れからの復元: 一時保存して A1 へ移り、ログインし直すと書きかけを戻せる', async ({
    page,
    context,
    login,
  }) => {
    await login({ admin: true })
    await page.goto('/admin/blog/new')
    const stamp = Date.now()
    await page.getByLabel('タイトル').first().fill(`期限切れ ${stamp}`)

    // セッションが切れた状態で保存する
    await context.clearCookies()
    await page.getByRole('button', { name: '下書き保存' }).click()
    await expect(page).toHaveURL(/\/admin\/login\?redirect=%2Fadmin%2Fblog%2Fnew/)

    await login({ admin: true })
    await page.goto('/admin/blog/new')
    await page.getByRole('button', { name: '復元する' }).click()
    await expect(page.getByLabel('タイトル').first()).toHaveValue(`期限切れ ${stamp}`)
  })
})

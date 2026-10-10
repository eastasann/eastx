/**
 * アクセシビリティ（P1〜P6・A1・A2・A10 と、A3・A4・A5・A7・A8・A11 の編集ビューで axe の serious 以上の違反 0件。SDD 10章）と、
 * セキュリティヘッダー・X-Robots-Tag（SDD 7章・ADR-019）。どの画面でもブラウザに CSP の違反が出ないことも確かめる。
 * make e2e のデモデータ（make db-seed）を前提にする
 */
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { gotoHydrated } from './hydration'

const PUBLIC_PAGES = [
  { name: 'P1 トップ', path: '/ja' },
  { name: 'P1 トップ（英語）', path: '/en' },
  { name: 'P2 作品詳細', path: '/ja/works/portfolio-cms' },
  { name: 'P3 プロジェクト詳細', path: '/ja/projects/payment-renewal' },
  { name: 'P4 ブログ記事', path: '/ja/blog/hello-eastx' },
  { name: 'P5 コーディング記録詳細', path: '/en/coding/learn-elysia' },
  { name: 'P6 プライバシー', path: '/ja/privacy' },
] as const

/** ページの読み込みの前から、CSP の違反（securitypolicyviolation）とコンソールの CSP のエラーを集める */
async function collectCspViolations(page: Page): Promise<() => Promise<string[]>> {
  const consoleMessages: string[] = []
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) consoleMessages.push(message.text())
  })
  await page.addInitScript(() => {
    const violations: string[] = []
    ;(window as unknown as { __cspViolations: string[] }).__cspViolations = violations
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(`${event.violatedDirective} ${event.blockedURI}`)
    })
  })
  return async () => [
    ...consoleMessages,
    ...(await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations)),
  ]
}

async function seriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze()
  return violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target.join(' ')),
    }))
}

test.describe('公開側', () => {
  for (const { name, path } of PUBLIC_PAGES) {
    for (const theme of ['light', 'dark'] as const) {
      test(`${name}（${theme}）: axe の重大な違反がなく、CSP の違反も出ない`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme })
        const violationsOf = await collectCspViolations(page)
        await gotoHydrated(page, path)
        expect(await seriousViolations(page)).toEqual([])
        expect(await violationsOf()).toEqual([])
      })
    }
  }

  test('P1 トップ（経歴・作品・プロジェクトの行を広げた状態）: axe の重大な違反がない', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    for (const id of ['career', 'projects', 'works']) {
      const toggle = page.locator(`#${id} ul:not([inert])`).getByRole('button', { expanded: false }).first()
      // キーボードで広げる
      await toggle.focus()
      await page.keyboard.press('Enter')
      await expect(page.locator(`#${id} [aria-expanded="true"]`)).toHaveCount(1)
    }
    expect(await seriousViolations(page)).toEqual([])
  })
})

test.describe('管理画面', () => {
  test('A1 ログイン: axe の重大な違反がなく、CSP の違反も出ない', async ({ page }) => {
    const violationsOf = await collectCspViolations(page)
    await page.goto('/admin/login')
    await expect(page.getByRole('button', { name: 'GitHubでログイン' })).toBeEnabled()
    expect(await seriousViolations(page)).toEqual([])
    expect(await violationsOf()).toEqual([])
  })

  for (const theme of ['light', 'dark'] as const) {
    test(`A2 ダッシュボード（${theme}）: axe の重大な違反がなく、CSP の違反も出ない`, async ({ page, login }) => {
      await page.emulateMedia({ colorScheme: theme })
      await login({ admin: true })
      const violationsOf = await collectCspViolations(page)
      await page.goto('/admin')
      await expect(page.getByRole('list', { name: '種類ごとの件数' }).getByRole('listitem')).toHaveCount(6)
      expect(await seriousViolations(page)).toEqual([])
      expect(await violationsOf()).toEqual([])
    })
  }

  for (const theme of ['light', 'dark'] as const) {
    test(`A10 アクセス解析（${theme}）: axe の重大な違反がなく、CSP の違反も出ない`, async ({ page, login }) => {
      await page.emulateMedia({ colorScheme: theme })
      await login({ admin: true })
      const violationsOf = await collectCspViolations(page)
      await page.goto('/admin/analytics?range=30d')
      await expect(page.getByRole('group', { name: '推移の区切り' })).toBeVisible()
      expect(await seriousViolations(page)).toEqual([])
      expect(await violationsOf()).toEqual([])
    })
  }

  test('A10 の期間とグラフのツールチップはキーボードだけで操作できる', async ({ page, login }) => {
    await login({ admin: true })
    await page.goto('/admin/analytics?range=30d')
    const ranges = page.getByRole('radiogroup', { name: '期間' })
    await ranges.getByRole('radio', { name: '30日' }).focus()
    await page.keyboard.press('ArrowLeft')
    await expect(ranges.getByRole('radio', { name: '7日' })).toBeChecked()
    await expect(page).toHaveURL(/range=7d$/)
    // グラフの区切りは Tab で1つだけに入り、矢印キーで移ってツールチップに値を出す
    const bars = page.getByRole('group', { name: '推移の区切り' }).getByRole('button')
    await expect(bars).toHaveCount(7)
    await bars.last().focus()
    await page.keyboard.press('ArrowLeft')
    await expect(bars.nth(5)).toBeFocused()
    await expect(page.getByRole('tooltip')).toContainText('閲覧')
    await page.keyboard.press('Tab')
    await expect(bars.nth(5)).not.toBeFocused()
    expect(
      await bars.evaluateAll((elements) => elements.filter((e) => e.getAttribute('tabindex') === '0').length),
    ).toBe(1)
  })

  /** 編集ビュー（L5 の作品・ブログ、L6 の経歴）。一覧の先頭の項目を開く */
  const EDIT_VIEWS = [
    { name: 'A5 作品の編集', list: '/admin/works', table: 'Lab の一覧' },
    { name: 'A8 ブログの編集', list: '/admin/blog', table: 'Blog の一覧' },
    { name: 'A4 経歴の編集', list: '/admin/careers', table: 'Career の一覧' },
  ] as const

  for (const { name, list, table } of EDIT_VIEWS) {
    for (const theme of ['light', 'dark'] as const) {
      test(`${name}（${theme}）: axe の重大な違反がない`, async ({ page, login }) => {
        await page.emulateMedia({ colorScheme: theme })
        await login({ admin: true })
        await page.goto(list)
        await page.getByRole('table', { name: table }).locator('tbody tr').first().getByRole('link').first().click()
        await expect(page.getByRole('radiogroup', { name: '表示' })).toBeVisible()
        await expect(page.getByRole('status').filter({ hasText: /^保存済み/ })).toBeVisible()
        expect(await seriousViolations(page)).toEqual([])
      })
    }
  }

  for (const theme of ['light', 'dark'] as const) {
    test(`A3 プロフィール編集（${theme}）: axe の重大な違反がない`, async ({ page, login }) => {
      await page.emulateMedia({ colorScheme: theme })
      await login({ admin: true })
      await page.goto('/admin/profile')
      await expect(page.getByRole('radiogroup', { name: '表示' })).toBeVisible()
      await expect(page.getByRole('status').filter({ hasText: /^保存済み/ })).toBeVisible()
      expect(await seriousViolations(page)).toEqual([])
    })
  }

  for (const theme of ['light', 'dark'] as const) {
    test(`A11 プライバシー編集（${theme}）: axe の重大な違反がない`, async ({ page, login }) => {
      await page.emulateMedia({ colorScheme: theme })
      await login({ admin: true })
      await page.goto('/admin/privacy')
      await expect(page.getByRole('radiogroup', { name: '表示' })).toBeVisible()
      await expect(page.getByRole('status').filter({ hasText: /^保存済み/ })).toBeVisible()
      // 保存済みの本文があるときだけ出す「公開サイトで見る」も検査に入れる
      await expect(page.getByRole('link', { name: /公開サイトで見る/ })).toBeVisible()
      expect(await seriousViolations(page)).toEqual([])
    })
  }

  for (const theme of ['light', 'dark'] as const) {
    test(`A7 使用技術の編集（${theme}）: axe の重大な違反がない`, async ({ page, login }) => {
      await page.emulateMedia({ colorScheme: theme })
      await login({ admin: true })
      await page.goto('/admin/stacks')
      // Core の技術を開き、押せない「トップに表示する」と欄の下の説明も検査に入れる
      await page.getByRole('table', { name: 'Tech Stack の一覧' }).getByRole('link', { name: 'TypeScript' }).click()
      await expect(page.getByRole('checkbox', { name: 'トップに表示する' })).toBeDisabled()
      await expect(page.getByRole('status').filter({ hasText: /^保存済み/ })).toBeVisible()
      expect(await seriousViolations(page)).toEqual([])
    })
  }

  test('表示の切り替え・設定の引き出し・画像を挿入はキーボードだけで操作できる', async ({ page, login }) => {
    await login({ admin: true })
    // 設定の引き出しは 1280px 未満
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.goto('/admin/blog/new')
    const editor = page.getByRole('textbox', { name: '本文（日本語）' })
    await editor.fill('## 見出し')

    // 表示の切り替え: 選んでいる項目にフォーカスし、矢印キーで選び直す
    const views = page.getByRole('radiogroup', { name: '表示' })
    await views.getByRole('radio', { name: '並べる' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(views.getByRole('radio', { name: '日英' })).toBeChecked()
    await expect(page.getByRole('textbox', { name: '本文（英語）' })).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(views.getByRole('radio', { name: 'プレビュー' })).toBeChecked()
    await expect(
      page.getByRole('region', { name: 'プレビュー' }).getByRole('heading', { name: '見出し' }),
    ).toBeVisible()

    // 設定の引き出し: Enter で開き、Esc で閉じてボタンへ戻る
    const settings = page.getByRole('button', { name: '設定' })
    await settings.focus()
    await page.keyboard.press('Enter')
    const drawer = page.getByRole('dialog', { name: '設定' })
    await expect(drawer.getByRole('textbox', { name: 'スラッグ' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    await expect(settings).toBeFocused()

    // 画像を挿入: Enter でファイルの選択を開く
    await views.getByRole('radio', { name: 'プレビュー' }).focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(views.getByRole('radio', { name: '並べる' })).toBeChecked()
    const insert = page.getByRole('button', { name: '画像を挿入' }).first()
    await insert.focus()
    const chooser = page.waitForEvent('filechooser')
    await page.keyboard.press('Enter')
    expect((await chooser).isMultiple()).toBe(true)
  })

  test('L5 の編集ビュー（エディタとプレビュー）でも CSP の違反が出ない', async ({ page, login }) => {
    await login({ admin: true })
    const violationsOf = await collectCspViolations(page)
    await page.goto('/admin/blog/new')
    await page.getByRole('textbox', { name: '本文（日本語）' }).fill('## 見出し\n\n```ts\nconst a = 1\n```')
    await expect(
      page.getByRole('region', { name: 'プレビュー' }).getByRole('heading', { name: '見出し' }),
    ).toBeVisible()
    expect(await violationsOf()).toEqual([])
  })
})

test.describe('レスポンスヘッダー', () => {
  const SECURITY = {
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
  }

  test('HTML と API にセキュリティヘッダーと CSP を付ける', async ({ request }) => {
    for (const path of ['/ja', '/ja/works/portfolio-cms', '/admin/login', '/api/admin/dashboard', '/ja/no-such']) {
      const response = await request.get(path, { maxRedirects: 0 })
      const headers = response.headers()
      for (const [name, value] of Object.entries(SECURITY)) expect(headers[name], `${path} ${name}`).toBe(value)
      expect(headers['content-security-policy'], path).toContain("default-src 'self'")
      expect(headers['content-security-policy'], path).toContain("frame-ancestors 'none'")
    }
  })

  test('X-Robots-Tag は /admin・/api に付け、公開側のページには付けない（ローカル）', async ({ request }) => {
    for (const path of ['/admin/login', '/admin', '/api/admin/dashboard', '/api/auth/get-session']) {
      const response = await request.get(path, { maxRedirects: 0 })
      expect(response.headers()['x-robots-tag'], path).toBe('noindex, nofollow')
    }
    for (const path of ['/ja', '/en/blog/hello-eastx']) {
      const response = await request.get(path)
      expect(response.headers()['x-robots-tag'], path).toBeUndefined()
    }
  })

  test('管理画面の HTML は meta robots の noindex も持つ', async ({ page, login }) => {
    await login({ admin: true })
    await page.goto('/admin')
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
  })
})

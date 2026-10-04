/**
 * アクセシビリティ（P1〜P5・A1・A2 で axe の serious 以上の違反 0件。SDD 10章）と、
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

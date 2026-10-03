/**
 * A1 ログインと管理画面のガード（design-spec 6.4、SDD 4.1・5.2・8章）。
 * GitHub の認可画面へは出ない: ログインの開始の応答はブラウザの側で差し替え、
 * ログイン済みの状態はフィクスチャが作ったセッションの Cookie で作る。
 */
import type { Route } from '@playwright/test'
import { expect, test } from './fixtures'

const LOGIN_BUTTON = { name: 'GitHubでログイン' } as const

test.describe('未ログイン', () => {
  test('/admin は A1 へ移り、redirect に開こうとしたパスが付く', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).toHaveURL('/admin/login?redirect=%2Fadmin')
    await expect(page.getByRole('heading', { name: 'eastasian 管理画面' })).toBeVisible()
    await expect(page.getByRole('button', LOGIN_BUTTON)).toBeEnabled()
  })

  test('クエリ付きの管理画面のパスも redirect に残る', async ({ page }) => {
    await page.goto('/admin/works?status=draft')
    await expect(page).toHaveURL(/\/admin\/login\?redirect=/)
    expect(new URL(page.url()).searchParams.get('redirect')).toBe('/admin/works?status=draft')
  })

  test('期限の切れたセッションでは A1 へ移る', async ({ page, login }) => {
    await login({ expiresAt: new Date(Date.now() - 60 * 1000) })
    await page.goto('/admin')
    await expect(page).toHaveURL('/admin/login?redirect=%2Fadmin')
  })

  test('セッションを確かめられなければ A1 に通信エラーを出す', async ({ page }) => {
    await page.route('**/api/auth/get-session', (route) => route.abort('internetdisconnected'))
    await page.goto('/admin/works')
    await expect(page).toHaveURL(/\/admin\/login\?/)
    const params = new URL(page.url()).searchParams
    expect(params.get('redirect')).toBe('/admin/works')
    expect(params.get('error')).toBe('session_check_failed')
    await expect(page.getByRole('status')).toHaveText('ログインできませんでした。もう一度お試しください')
  })

  for (const [query, message] of [
    ['error=unable_to_create_user', 'このアカウントでは管理画面に入れません'],
    ['error=unable_to_create_session', 'このアカウントでは管理画面に入れません'],
    ['error=forbidden', 'このアカウントでは管理画面に入れません'],
    ['error=access_denied', 'ログインがキャンセルされました'],
    ['error=invalid_code', 'ログインできませんでした。もう一度お試しください'],
    ['loggedOut=1', 'ログアウトしました'],
  ] as const) {
    test(`A1 の ?${query} は「${message}」`, async ({ page }) => {
      await page.goto(`/admin/login?${query}`)
      await expect(page.getByRole('status')).toHaveText(message)
      await expect(page.getByRole('button', LOGIN_BUTTON)).toBeEnabled()
    })
  }

  test('ログインの開始: 戻り待ちの間はボタンを無効にし、redirect を callbackURL に渡す', async ({ page }) => {
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let body: unknown
    await page.route('**/api/auth/sign-in/social', async (route: Route) => {
      body = route.request().postDataJSON()
      await held
      // GitHub の認可画面の代わりに A1 へ移す（クライアントは url へ移る）
      await route.fulfill({ json: { url: '/admin/login?error=access_denied', redirect: true } })
    })
    await page.goto('/admin/login?redirect=%2Fadmin%2Fworks')
    await page.getByRole('button', LOGIN_BUTTON).click()
    await expect(page.getByRole('button', LOGIN_BUTTON)).toBeDisabled()
    await expect(page.getByRole('status')).toHaveText('ログインしています…')
    release?.()
    await expect(page).toHaveURL('/admin/login?error=access_denied')
    expect(body).toEqual({
      provider: 'github',
      callbackURL: '/admin/works',
      errorCallbackURL: '/admin/login?redirect=%2Fadmin%2Fworks',
    })
  })

  test('redirect が管理画面の外なら callbackURL は /admin', async ({ page }) => {
    let body: unknown
    await page.route('**/api/auth/sign-in/social', async (route: Route) => {
      body = route.request().postDataJSON()
      await route.abort()
    })
    await page.goto('/admin/login?redirect=https%3A%2F%2Fevil.example%2F')
    await page.getByRole('button', LOGIN_BUTTON).click()
    await expect(page.getByRole('status')).toHaveText('ログインできませんでした。もう一度お試しください')
    expect(body).toMatchObject({ callbackURL: '/admin', errorCallbackURL: '/admin/login?redirect=%2Fadmin' })
  })

  for (const [name, respond] of [
    ['通信が切れた', (route: Route) => route.abort('internetdisconnected')],
    // GitHub のキーが未設定のとき、Better Auth はプロバイダーがないとして 404 を返す
    ['エラーが返った', (route: Route) => route.fulfill({ status: 404, json: { code: 'PROVIDER_NOT_FOUND' } })],
  ] as const) {
    test(`ログインの開始で${name}ら通信エラーを出し、もう一度押せる`, async ({ page }) => {
      await page.route('**/api/auth/sign-in/social', respond)
      await page.goto('/admin/login')
      await page.getByRole('button', LOGIN_BUTTON).click()
      await expect(page.getByRole('status')).toHaveText('ログインできませんでした。もう一度お試しください')
      await expect(page.getByRole('button', LOGIN_BUTTON)).toBeEnabled()
    })
  }
})

// 管理者のセッション。管理者でないセッションは、A2〜A9 が表示のときに呼ぶ CMS API の FORBIDDEN で A1 へ移る（SDD 7章）
test.describe('ログイン済み', () => {
  test('/admin でサイドメニューに GitHub のユーザー名が出る', async ({ page, login }) => {
    const { githubLogin } = await login({ admin: true })
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: '管理メニュー' })).toContainText(`@${githubLogin}`)
  })

  test('A1 を開くとダッシュボードへ移る', async ({ page, login }) => {
    await login({ admin: true })
    await page.goto('/admin/login')
    await expect(page).toHaveURL('/admin')
  })

  test('A1 を redirect 付きで開くとそこへ移る', async ({ page, login }) => {
    await login({ admin: true })
    await page.goto('/admin/login?redirect=%2Fadmin%3Ftab%3Dx')
    await expect(page).toHaveURL('/admin?tab=x')
  })

  test('error 付きの A1 はログイン済みでもそのまま状態を出す', async ({ page, login }) => {
    await login({ admin: true })
    await page.goto('/admin/login?error=forbidden')
    await expect(page.getByRole('status')).toHaveText('このアカウントでは管理画面に入れません')
    await expect(page).toHaveURL('/admin/login?error=forbidden')
  })

  test('管理画面の存在しない URL は /admin へ移る', async ({ page, login }) => {
    await login({ admin: true })
    await page.goto('/admin/no-such/page')
    await expect(page).toHaveURL('/admin')
    await expect(page.getByRole('heading', { name: 'ダッシュボード' })).toBeVisible()
  })

  test('ログアウトすると A1 に「ログアウトしました」を出し、管理画面に入れなくなる', async ({ page, login }) => {
    await login({ admin: true })
    await page.goto('/admin')
    await page.getByRole('button', { name: 'ログアウト' }).click()
    await expect(page).toHaveURL('/admin/login?loggedOut=1')
    await expect(page.getByRole('status')).toHaveText('ログアウトしました')
    await page.goto('/admin')
    await expect(page).toHaveURL('/admin/login?redirect=%2Fadmin')
  })

  test('ログアウトに失敗したら、その場で伝えて画面はそのまま', async ({ page, login }) => {
    await login({ admin: true })
    await page.route('**/api/auth/sign-out', (route) => route.abort('internetdisconnected'))
    await page.goto('/admin')
    await page.getByRole('button', { name: 'ログアウト' }).click()
    await expect(page.getByText('ログアウトできませんでした。もう一度お試しください')).toBeVisible()
    await expect(page).toHaveURL('/admin')
    await expect(page.getByRole('button', { name: 'ログアウト' })).toBeEnabled()
  })
})

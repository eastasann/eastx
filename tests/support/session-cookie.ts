/**
 * ローカルで作ったセッションをブラウザに渡すための、Cookie の名前と署名の鍵。
 * E2E のログイン（tests/e2e/fixtures.ts）とデータ移行の確認（scripts/migrate-legacy/verify.ts）で共通に使う。
 * 名前と、BETTER_AUTH_SECRET が空のときに Better Auth が使う値は、ライブラリ自身に決めさせる。
 * cookiePrefix は src/auth/server.ts と同じ値にする（違えばログインできずに確認が落ちる）
 */
import { betterAuth } from 'better-auth'

export async function sessionCookieSettings(env: {
  SITE_URL: string
  BETTER_AUTH_SECRET: string
}): Promise<{ cookieName: string; secret: string }> {
  const auth = betterAuth({
    baseURL: env.SITE_URL,
    secret: env.BETTER_AUTH_SECRET,
    advanced: { cookiePrefix: 'eastx' },
    logger: { disabled: true },
  })
  const context = await auth.$context
  return { cookieName: context.authCookies.sessionToken.name, secret: context.secret }
}

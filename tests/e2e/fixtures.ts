/**
 * E2E のログイン（SDD 10章）。make e2e が動かすプレビューと同じローカルの D1 にユーザーとセッションを作り、
 * Better Auth と同じ方式で署名したセッションの Cookie をブラウザに入れる。本番のコードにテスト用の入口は作らない。
 *
 * - `login({ admin: true })`: ADMIN_GITHUB_USER_ID（.dev.vars）の管理者のセッション。CMS API を呼ぶ流れで使う。
 *   手元でログインして作った管理者の行があればそれを使い、消さない。無ければ作り、テストの終わりに消す
 * - `login()`: 管理者でないユーザーのセッション（SDD 7章の「管理者でないセッション」）。テストごとに別の GitHub ID で作り、
 *   テストの終わりに消す。期限切れのセッションの確認など、管理者かどうかに関わらない流れで使う
 *
 * 作ったセッションは、ユーザーを消すとき ON DELETE CASCADE で消える。使い回した管理者の行のセッションは個別に消す。
 */
import { test as base } from '@playwright/test'
import { betterAuth } from 'better-auth'
import { eq } from 'drizzle-orm'
import { type DrizzleD1Database, drizzle } from 'drizzle-orm/d1'
import { getPlatformProxy } from 'wrangler'
import * as schema from '../../src/db/schema'
import { signCookieValue } from '../support/signed-cookie'

type Db = DrizzleD1Database<typeof schema>

export interface LoginOptions {
  /** ADMIN_GITHUB_USER_ID の管理者としてログインする */
  admin?: boolean
  /** 過去にすると、期限の切れたセッションになる */
  expiresAt?: Date
}

export interface LoggedInUser {
  githubLogin: string
}

interface WorkerFixtures {
  local: { db: Db; cookieName: string; secret: string; adminGithubUserId: string }
}

interface TestFixtures {
  login: (options?: LoginOptions) => Promise<LoggedInUser>
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  local: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright のフィクスチャは第1引数の分割代入を要る
    async ({}, use) => {
      // make db-seed と同じく、wrangler.jsonc のトップレベル（ローカル）の D1 と .dev.vars を開く
      const proxy = await getPlatformProxy<Env>({
        configPath: './wrangler.jsonc',
        persist: true,
        remoteBindings: false,
      })
      try {
        if (proxy.env.ENVIRONMENT !== 'local') throw new Error(`ENVIRONMENT=${proxy.env.ENVIRONMENT} の設定を開いた`)
        // Cookie の名前と、BETTER_AUTH_SECRET が空のときに Better Auth が使う値は、ライブラリ自身に決めさせる。
        // cookiePrefix は src/auth/server.ts と同じ値にする（違えばログインできずにテストが落ちる）
        const auth = betterAuth({
          baseURL: proxy.env.SITE_URL,
          secret: proxy.env.BETTER_AUTH_SECRET,
          advanced: { cookiePrefix: 'eastx' },
          logger: { disabled: true },
        })
        const context = await auth.$context
        await use({
          db: drizzle(proxy.env.DB, { schema }),
          cookieName: context.authCookies.sessionToken.name,
          secret: context.secret,
          adminGithubUserId: proxy.env.ADMIN_GITHUB_USER_ID,
        })
      } finally {
        await proxy.dispose()
      }
    },
    { scope: 'worker' },
  ],

  login: async ({ local, context, baseURL }, use) => {
    const createdUserIds: string[] = []
    const sessionIds: string[] = []

    async function adminUserId(): Promise<{ id: string; githubLogin: string }> {
      if (local.adminGithubUserId === '') {
        throw new Error('管理者のセッションには .dev.vars の ADMIN_GITHUB_USER_ID が要る（docs/03_dev-setup.md 6章）')
      }
      const existing = await local.db
        .select({ id: schema.adminUser.id, githubLogin: schema.adminUser.githubLogin })
        .from(schema.adminUser)
        .where(eq(schema.adminUser.githubUserId, local.adminGithubUserId))
        .get()
      if (existing) return existing
      return createUser(local.adminGithubUserId)
    }

    async function createUser(githubUserId: string): Promise<{ id: string; githubLogin: string }> {
      const now = new Date()
      const id = crypto.randomUUID()
      const githubLogin = `e2e-${id.slice(0, 8)}`
      await local.db.insert(schema.adminUser).values({
        id,
        name: githubLogin,
        email: `${id}@example.invalid`,
        githubUserId,
        githubLogin,
        createdAt: now,
        updatedAt: now,
      })
      createdUserIds.push(id)
      return { id, githubLogin }
    }

    await use(async (options = {}) => {
      // 管理者でないユーザーの GitHub ID は、ADMIN_GITHUB_USER_ID と重ならないよう数値の範囲の外の値にする
      const user = options.admin ? await adminUserId() : await createUser(`e2e-${crypto.randomUUID()}`)
      const now = new Date()
      const sessionId = crypto.randomUUID()
      const token = crypto.randomUUID().replaceAll('-', '')
      await local.db.insert(schema.adminSession).values({
        id: sessionId,
        token,
        userId: user.id,
        expiresAt: options.expiresAt ?? new Date(now.getTime() + 24 * 60 * 60 * 1000),
        createdAt: now,
        updatedAt: now,
      })
      sessionIds.push(sessionId)
      await context.addCookies([
        {
          name: local.cookieName,
          value: await signCookieValue(token, local.secret),
          url: baseURL ?? 'http://localhost:3000',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ])
      return { githubLogin: user.githubLogin }
    })

    // login は context より後に用意されるので、context より先に片付く。開いたままのページ（ダッシュボードの読み込みなど）が
    // プレビューの Worker を通して同じ D1 のファイルを読み書きしていると、ここの書き込みが SQLITE_BUSY で落ちるので、先に閉じる
    for (const opened of context.pages()) await opened.close()
    for (const id of sessionIds) await local.db.delete(schema.adminSession).where(eq(schema.adminSession.id, id))
    for (const id of createdUserIds) await local.db.delete(schema.adminUser).where(eq(schema.adminUser.id, id))
  },
})

export { expect } from '@playwright/test'

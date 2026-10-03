/**
 * Better Auth のサーバー側の設定（SDD 5.2・ADR-009）。セッションは DB に持ち、Cookie は署名付き。
 * 管理者は ADMIN_GITHUB_USER_ID の GitHub アカウントだけで、hooks で作成の段階から拒否し、
 * API の認可（src/api/middleware/index.ts の authorize）でも同じ ID かを確かめる。
 */

import { env } from 'cloudflare:workers'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { eq } from 'drizzle-orm'
import { getDb } from '../db/client'
import { adminAccount, adminSession, adminUser, authVerification } from '../db/schema'

/** セッションの有効期限30日、1日ごとに延長（ADR-009） */
const SESSION_EXPIRES_IN = 60 * 60 * 24 * 30
const SESSION_UPDATE_AGE = 60 * 60 * 24

async function isAdminUser(workerEnv: Env, userId: string): Promise<boolean> {
  const row = await getDb(workerEnv)
    .select({ githubUserId: adminUser.githubUserId })
    .from(adminUser)
    .where(eq(adminUser.id, userId))
    .get()
  return row !== undefined && isAdminGithubUserId(workerEnv, row.githubUserId)
}

/** ADMIN_GITHUB_USER_ID が空のときは誰も通さない */
export function isAdminGithubUserId(workerEnv: Env, githubUserId: unknown): boolean {
  return workerEnv.ADMIN_GITHUB_USER_ID !== '' && githubUserId === workerEnv.ADMIN_GITHUB_USER_ID
}

const createAuth = (workerEnv: Env) => {
  // Better Auth は secret が空だと公開されている既定の値で動き、拒否するのは NODE_ENV=production のときだけ。
  // Workers には NODE_ENV が無いので、設定し忘れを黙って通さないよう、ローカル以外では空を拒否する
  if (workerEnv.BETTER_AUTH_SECRET === '' && workerEnv.ENVIRONMENT !== 'local') {
    throw new Error('BETTER_AUTH_SECRET が設定されていない')
  }
  return betterAuth({
    baseURL: workerEnv.SITE_URL,
    basePath: '/api/auth',
    secret: workerEnv.BETTER_AUTH_SECRET,
    trustedOrigins: [workerEnv.SITE_URL],
    database: drizzleAdapter(getDb(workerEnv), {
      provider: 'sqlite',
      schema: { user: adminUser, session: adminSession, account: adminAccount, verification: authVerification },
    }),
    socialProviders: {
      github: {
        // キーが未設定のまま有効にすると、空の client_id で GitHub へ送り出してしまう。無効にしておけば
        // ログインの開始が 404 になり、A1 は通信エラーを出す（ローカルでキーを入れる前もアプリは動く）
        enabled: workerEnv.GITHUB_CLIENT_ID !== '' && workerEnv.GITHUB_CLIENT_SECRET !== '',
        clientId: workerEnv.GITHUB_CLIENT_ID,
        clientSecret: workerEnv.GITHUB_CLIENT_SECRET,
        // ログインのたびに GitHub のユーザー名などを最新にする
        overrideUserInfoOnSignIn: true,
        mapProfileToUser: (profile) => ({ githubUserId: String(profile.id), githubLogin: profile.login }),
      },
    },
    user: {
      additionalFields: {
        // input は許す。1.7.7 は input: false のフィールドを mapProfileToUser 由来でも受け付けず、
        // ユーザー作成が MISSING_FIELD で落ちる（SDD 5.2）。書き換えの入口は
        // /api/auth/update-user を Elysia で塞いで閉じる（src/api/app.ts）
        githubUserId: { type: 'string', required: true },
        githubLogin: { type: 'string', required: true },
      },
    },
    session: { expiresIn: SESSION_EXPIRES_IN, updateAge: SESSION_UPDATE_AGE },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => (isAdminGithubUserId(workerEnv, user.githubUserId) ? { data: user } : false),
        },
      },
      session: {
        create: {
          before: async (session) => ((await isAdminUser(workerEnv, session.userId)) ? { data: session } : false),
        },
      },
    },
    // state の期限切れ・戻りの URL の再読み込みなど、ログインの開始で渡した errorCallbackURL を読めない失敗の行き先。
    // 既定の /api/auth/error（Better Auth の画面）ではなく A1 に error を付けて戻す（SDD 5.2）
    onAPIError: { errorURL: '/admin/login' },
    advanced: { cookiePrefix: 'eastx', database: { generateId: () => crypto.randomUUID() } },
  })
}

export type Auth = ReturnType<typeof createAuth>

let instance: Auth | undefined

/**
 * Worker の env から作った Better Auth のインスタンス。env はアイソレートの中で変わらないので、
 * リクエストごとに設定の初期化（スキーマの検証など）をやり直さないよう使い回す。
 */
export function getAuth(): Auth {
  instance ??= createAuth(env)
  return instance
}

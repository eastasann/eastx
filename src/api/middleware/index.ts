/**
 * 全手続きに一律にかけるミドルウェア（SDD 5.1 の 3〜5）。順は 認証 → レート制限 → 認可 で、
 * 手続きごとに付け外ししない。CSRF（2）はハンドラーのプラグインで、これより前に確かめる（src/api/app.ts）。
 * 入力の検証はこのあとに走るので、未認証のリクエストは本文の誤りより先に 401 になる。
 */

import { env } from 'cloudflare:workers'
import { ORPCError, os } from '@orpc/server'
import { getAuth, isAdminGithubUserId } from '../../auth/server'
import type { RequestContext } from '../context'
import { baseErrors } from '../contract/common'

const base = os.$context<RequestContext>()

function definedError(code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'TOO_MANY_REQUESTS') {
  const { status, message } = baseErrors[code]
  return new ORPCError(code, { status, message })
}

/**
 * 3. 認証: Better Auth の getSession でセッションを読む（署名・期限・DB の行を確かめる）。
 * 延長（updateAge）はしない。ここで DB の期限を延ばしても、延ばした Cookie をレスポンスに載せる経路がなく、
 * ブラウザの Cookie だけが古い期限で切れる。延長は Cookie を返せる GET /api/auth/get-session に任せる（SDD 5.1）
 */
export const authenticate = base.middleware(async ({ context, next }) => {
  const session = await getAuth().api.getSession({ headers: context.headers, query: { disableRefresh: true } })
  if (!session) throw definedError('UNAUTHORIZED')
  return next({ context: { userId: session.user.id, githubUserId: session.user.githubUserId } })
})

/** 4. レート制限: セッションのユーザーごとに数える（ADR-021） */
export const rateLimit = base.$context<RequestContext & { userId: string }>().middleware(async ({ context, next }) => {
  const { success } = await env.ADMIN_RATE_LIMITER.limit({ key: context.userId })
  if (!success) throw definedError('TOO_MANY_REQUESTS')
  return next()
})

/** 5. 認可: セッションの GitHub ID が ADMIN_GITHUB_USER_ID と一致する人だけを通す */
export const authorize = base
  .$context<RequestContext & { githubUserId: string }>()
  .middleware(async ({ context, next }) => {
    if (!isAdminGithubUserId(env, context.githubUserId)) throw definedError('FORBIDDEN')
    return next()
  })

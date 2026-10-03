/**
 * Better Auth のクライアント（SDD 5.2）。管理画面（ssr: false）だけが使う。
 * 同じ origin の `/api/auth` を呼ぶので baseURL は渡さない。
 */
import { inferAdditionalFields } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import type { Auth } from './server'

export const authClient = createAuthClient({
  // githubUserId・githubLogin（server.ts の additionalFields）をセッションの user の型に載せる
  plugins: [inferAdditionalFields<Auth>()],
})

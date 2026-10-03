/**
 * 管理画面の CMS API クライアント（SDD 5章・8章）。コントラクトから型が付き、CSRF のヘッダーを付けて送る。
 * 認可のエラーはここで一律に受けて画面を移す（各画面で個別に扱わない）。
 */
import { createORPCClient, ORPCError, onError } from '@orpc/client'
import { SimpleCsrfProtectionLinkPlugin } from '@orpc/client/plugins'
import type { ContractRouterClient } from '@orpc/contract'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { API_BASE_PATH } from '~/api/constants'
import { type Contract, contract } from '~/api/contract'
import { authClient } from '~/auth/client'
import { FORBIDDEN_ERROR } from './auth'

export interface AuthErrorHandlerDeps {
  /** 今の管理画面のパス（パス・クエリ・ハッシュ）。ログインし直したら戻る先 */
  currentPath: () => string
  /** UNAUTHORIZED で A1 へ移る前に呼ぶ（編集ビューの一時保存と通知）。終わるまで移らない */
  beforeLoginRedirect: () => Promise<void>
  signOut: () => Promise<unknown>
  /** 画面を移す。同じ origin のパスを受ける */
  navigate: (href: string) => void
}

/**
 * SDD 8章の認可エラーの扱い:
 * - UNAUTHORIZED → `/admin/login?redirect={今のパス}`（ログインの有効期限切れ。移る前に beforeLoginRedirect を待つ）
 * - FORBIDDEN → ログアウトして、A1 に「管理者でないアカウント」を出す
 *
 * それ以外のエラーは何もしない（呼び出し元がそのまま受ける）
 */
export function createAuthErrorHandler(deps: AuthErrorHandlerDeps) {
  return async (error: unknown): Promise<void> => {
    if (!(error instanceof ORPCError)) return
    if (error.code === 'UNAUTHORIZED') {
      await deps.beforeLoginRedirect()
      deps.navigate(`/admin/login?${new URLSearchParams({ redirect: deps.currentPath() })}`)
      return
    }
    if (error.code === 'FORBIDDEN') {
      // ログアウトに失敗しても A1 へは移す。A1 は error の付いたときログイン済みでも A2 へ送り返さないので、
      // 管理者でないセッションが残っても行き来を繰り返さない
      await deps.signOut().catch(() => undefined)
      deps.navigate(`/admin/login?${new URLSearchParams({ error: FORBIDDEN_ERROR })}`)
    }
  }
}

type BeforeLoginRedirect = () => Promise<void> | void

const beforeLoginRedirectHandlers = new Set<BeforeLoginRedirect>()

/**
 * ログインの有効期限が切れて A1 へ移る前に呼ぶ処理を登録する（design-spec 6.4: 編集中の内容の一時保存と、
 * 「ログインの有効期限が切れました…」の通知）。返り値の関数で登録を外す。編集ビューが表示中だけ登録する
 */
export function onBeforeLoginRedirect(handler: BeforeLoginRedirect): () => void {
  beforeLoginRedirectHandlers.add(handler)
  return () => {
    beforeLoginRedirectHandlers.delete(handler)
  }
}

const handleAuthError = createAuthErrorHandler({
  currentPath: () => `${window.location.pathname}${window.location.search}${window.location.hash}`,
  // 一時保存などの1つが失敗しても A1 へは移す。期限の切れたセッションのまま画面に留めても、保存も操作もできない
  beforeLoginRedirect: async () => {
    await Promise.allSettled([...beforeLoginRedirectHandlers].map((handler) => handler()))
  },
  signOut: () => authClient.signOut(),
  // 一覧や編集のキャッシュを持ち越さないよう、ルーターの遷移ではなくページを読み込み直す
  navigate: (href) => window.location.assign(href),
})

export const api: ContractRouterClient<Contract> = createORPCClient(
  new OpenAPILink(contract, {
    url: () => `${window.location.origin}${API_BASE_PATH}`,
    plugins: [new SimpleCsrfProtectionLinkPlugin()],
    interceptors: [onError(handleAuthError)],
  }),
)

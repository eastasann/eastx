/**
 * A1 ログインの状態の判定と、ログイン後に戻る先の扱い（design-spec 6.4、SDD 5.2）。
 * 画面から切り離した純粋関数にして、ユニットテストで確かめる。
 */

/** ログイン後に戻る先がないときの行き先（A2） */
export const ADMIN_HOME = '/admin'

/**
 * API クライアントが FORBIDDEN を受けて A1 に移すときの `error` の値（SDD 8章）。
 * Better Auth のコードと重ならない名前にする
 */
export const FORBIDDEN_ERROR = 'forbidden'

/**
 * 管理画面のレイアウトがセッションを確かめられなかった（通信の失敗）ときの `error` の値。
 * A1 では SDD 5.2 の表の「それ以外」として通信エラーになる
 */
export const SESSION_CHECK_FAILED_ERROR = 'session_check_failed'

/** A1 の `error` クエリが表す状態（SDD 5.2 の表） */
export type LoginErrorState = 'notAdmin' | 'cancelled' | 'network'

export function loginErrorState(error: string): LoginErrorState {
  switch (error) {
    case 'unable_to_create_user':
    case 'unable_to_create_session':
    case FORBIDDEN_ERROR:
      return 'notAdmin'
    case 'access_denied':
      return 'cancelled'
    default:
      return 'network'
  }
}

/** design-spec 6.4 の文言 */
export const LOGIN_MESSAGES = {
  pending: 'ログインしています…',
  notAdmin: 'このアカウントでは管理画面に入れません',
  cancelled: 'ログインがキャンセルされました',
  network: 'ログインできませんでした。もう一度お試しください',
  loggedOut: 'ログアウトしました',
} as const

/**
 * `redirect` クエリの値を、戻ってよい管理画面のパス（パス・クエリ・ハッシュ）にする。戻れない値は ADMIN_HOME。
 * 外の origin や `//` で始まる値をそのまま使うとログインの直後に別のサイトへ送れてしまうので、
 * 同じ origin の `/admin` の下だけを通す。A1 自身に戻すと行き先がなくなるので、それも外す
 */
export function safeRedirect(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return ADMIN_HOME
  const base = 'http://admin.invalid'
  let url: URL
  try {
    url = new URL(value, base)
  } catch {
    return ADMIN_HOME
  }
  if (url.origin !== base) return ADMIN_HOME
  const { pathname } = url
  if (pathname !== ADMIN_HOME && !pathname.startsWith(`${ADMIN_HOME}/`)) return ADMIN_HOME
  if (pathname === `${ADMIN_HOME}/login` || pathname.startsWith(`${ADMIN_HOME}/login/`)) return ADMIN_HOME
  return `${pathname}${url.search}${url.hash}`
}

/** A1 のクエリ（SDD 4.1・5.2） */
export interface LoginSearch {
  /** ログイン後に戻る管理画面のパス */
  redirect?: string
  /** Better Auth が GitHub からの戻りの失敗で付けるコード、または API クライアント・レイアウトが付ける値 */
  error?: string
  /** ログアウトの直後（「ログアウトしました」を出す）。URL では `loggedOut=1`（SDD 5.2） */
  loggedOut?: 1
}

/** TanStack Router の validateSearch。形の違う値は捨てて、A1 を通常の状態で開く */
export function parseLoginSearch(search: Record<string, unknown>): LoginSearch {
  const result: LoginSearch = {}
  if (typeof search.redirect === 'string' && search.redirect !== '') result.redirect = search.redirect
  if (typeof search.error === 'string' && search.error !== '') result.error = search.error
  // TanStack Router はクエリの値を JSON として読むので、`loggedOut=1` は数値の 1 になる
  if (search.loggedOut === 1 || search.loggedOut === '1') result.loggedOut = 1
  return result
}

/**
 * Analytics Engine の SQL API（SDD ADR-023）。Cron の集計と A10 の今日の分が使う。
 * トークンの権限は Account Analytics: Read だけ（docs/04_deployment-procedure.md 3章）
 */

export interface SqlApiConfig {
  accountId: string
  token: string
}

/** 計測している本番だけにある。未登録（undefined）と空文字の両方を「無い」とする（staging・ローカル） */
export function sqlApiConfigOf(env: { CF_ACCOUNT_ID?: string; ANALYTICS_API_TOKEN?: string }): SqlApiConfig | null {
  const accountId = env.CF_ACCOUNT_ID ?? ''
  const token = env.ANALYTICS_API_TOKEN ?? ''
  return accountId === '' || token === '' ? null : { accountId, token }
}

export class SqlApiError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`Analytics Engine SQL API ${status}: ${detail}`)
    this.name = 'SqlApiError'
  }
}

/** 1回の問い合わせ。`FORMAT JSON` の `data` の行を返す。数は文字列で返ることがあるので、読む側で Number にする */
export async function querySql(
  config: SqlApiConfig,
  sql: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>[]> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/analytics_engine/sql`,
    { method: 'POST', headers: { authorization: `Bearer ${config.token}` }, body: sql, signal },
  )
  if (!response.ok) throw new SqlApiError(response.status, (await response.text()).slice(0, 500))
  const body = (await response.json()) as { data?: unknown }
  if (!Array.isArray(body.data)) throw new SqlApiError(response.status, 'data が無い応答')
  return body.data as Record<string, unknown>[]
}

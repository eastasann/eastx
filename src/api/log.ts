/**
 * アプリのログ。JSON の1行で出し、Workers Logs で検索する（SDD 8章、レベルの使い分けは runbook 1章）。
 * 本文・Cookie・トークン・シークレットは渡さない。
 */
import { env } from 'cloudflare:workers'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogFields {
  msg: string
  requestId: string
  route?: string
  code?: string
  [key: string]: unknown
}

export function log(level: LogLevel, fields: LogFields): void {
  // DEBUG（リクエストとレスポンスの詳細）は件数が多く、本番の Workers Logs の量と検索の妨げになるのでローカルだけ（runbook 1章）
  if (level === 'debug' && env.ENVIRONMENT !== 'local') return
  const line = JSON.stringify({ level, ...fields })
  if (level === 'error') console.error(line)
  else console.log(line)
}

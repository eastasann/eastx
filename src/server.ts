/**
 * Worker の入口（ADR-001）。`/api/*` と `/media/*` を Elysia へ、それ以外を TanStack Start へ振り分ける。
 * バインディングと環境変数は `cloudflare:workers` の env から読む（fetch の引数を引き回さない）。
 * 全体を withSentry で包み（SDD 11章）、レスポンスにセキュリティヘッダーと X-Robots-Tag を付ける（SDD 7章・ADR-019）。
 * `scheduled` は本番の Cron（解析の日ごとの集計。ADR-023）で、中身は src/api/analytics/rollup.ts に置く
 * （この入口は TanStack Start の仮想モジュールに依存し、結合テストから import できないため）
 */
import { env } from 'cloudflare:workers'
import { withSentry } from '@sentry/cloudflare'
import startHandler from '@tanstack/react-start/server-entry'
import { runAnalyticsCron } from './api/analytics/rollup'
import { sqlApiConfigOf } from './api/analytics/sql'
import { app } from './api/app'
import { getDb } from './db/client'
import { reportServerErrors, sentryOptions } from './monitoring/server'
import { withResponseHeaders } from './response-headers'

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname === '/media' || pathname.startsWith('/media/')
}

async function route(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url)
  if (isApiPath(pathname)) return app.fetch(request)
  return startHandler.fetch(request)
}

export default withSentry((workerEnv: Env) => sentryOptions(workerEnv), {
  async fetch(request) {
    const response = await reportServerErrors(request, route)
    return withResponseHeaders(new URL(request.url).pathname, response, {
      environment: env.ENVIRONMENT,
      sentryDsn: env.SENTRY_DSN,
    })
  },
  async scheduled(controller) {
    await runAnalyticsCron({
      db: getDb(env),
      config: sqlApiConfigOf(env),
      salts: env.ANALYTICS_SALTS,
      now: controller.scheduledTime,
    })
  },
} satisfies ExportedHandler<Env>)

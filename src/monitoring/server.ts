/**
 * サーバーのエラー追跡（SDD 11章・ADR-018）。Sentry に送るのは 5xx と想定外の例外だけ。
 * 入口（src/server.ts）を withSentry で包み、`SENTRY_DSN` が空なら何も送らない。
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import * as Sentry from '@sentry/cloudflare'
import { tracesSampleRate } from './sampling'

/** トレースしないパス。解析の受け口（SDD 5.14）は訪問者の表示と操作のたびに呼ばれ、Sentry の無料枠を食う（ADR-018） */
const UNTRACED_PATHS: ReadonlySet<string> = new Set(['/api/collect'])

type SamplingContext = Parameters<NonNullable<Sentry.CloudflareOptions['tracesSampler']>>[0]

function pathOf(context: SamplingContext): string | undefined {
  const url = context.normalizedRequest?.url
  if (url !== undefined) return new URL(url, 'http://localhost').pathname
  // リクエストの情報が無いときは、スパンの名前（`POST /api/collect`）から読む
  return context.name.split(' ')[1]
}

/** withSentry に渡す設定 */
export function sentryOptions(env: Pick<Env, 'SENTRY_DSN' | 'ENVIRONMENT'>): Sentry.CloudflareOptions {
  const rate = tracesSampleRate(env.ENVIRONMENT)
  return {
    dsn: env.SENTRY_DSN === '' ? undefined : env.SENTRY_DSN,
    environment: env.ENVIRONMENT,
    tracesSampler: (context) => (UNTRACED_PATHS.has(pathOf(context) ?? '') ? 0 : context.inheritOrSampleWith(rate)),
  }
}

const requestIds = new WeakMap<Request, string>()

/**
 * リクエストID（SDD 8章）。Cloudflare の `cf-ray`、ローカルでは UUID。
 * 同じ Request なら入口・API・Sentry のタグで同じ値を返す
 */
export function requestIdOf(request: Request): string {
  let requestId = requestIds.get(request)
  if (requestId === undefined) {
    requestId = request.headers.get('cf-ray') ?? crypto.randomUUID()
    requestIds.set(request, requestId)
  }
  return requestId
}

interface RequestReport {
  reported: boolean
}

const currentRequest = new AsyncLocalStorage<RequestReport>()

/**
 * 5xx にした例外を送る。`request_id` のタグでログ（SDD 8章）とつなぐ。
 * 呼んだリクエストでは、入口の 5xx の報告（reportServerErrors）が二重に送らない
 */
export function captureServerError(error: unknown, requestId: string): void {
  Sentry.captureException(error, { tags: { request_id: requestId } })
  const report = currentRequest.getStore()
  if (report) report.reported = true
}

/**
 * 1リクエストを処理し、5xx なのに例外を送っていなければ、状態コードとパスを送る。
 * 例外を捕まえて 5xx を返す場所（Better Auth・TanStack Start の中）は、ここでまとめて拾う。
 * withSentry はリクエストごとに分けたスコープで呼ぶので、そこに `request_id` を付け、
 * withSentry が自分で拾う例外（ここから投げられたもの）にも同じタグが付くようにする
 */
export async function reportServerErrors(
  request: Request,
  handle: (request: Request) => Promise<Response>,
): Promise<Response> {
  const requestId = requestIdOf(request)
  // withSentry は OPTIONS・HEAD を包まない（@sentry/cloudflare 11.4.0）。そのときのスコープは全リクエストで共有なので書かない
  if (request.method !== 'OPTIONS' && request.method !== 'HEAD') {
    Sentry.getIsolationScope().setTag('request_id', requestId)
  }
  const report: RequestReport = { reported: false }
  const response = await currentRequest.run(report, () => handle(request))
  if (response.status >= 500 && !report.reported) {
    Sentry.captureMessage(`${response.status} ${request.method} ${new URL(request.url).pathname}`, {
      level: 'error',
      tags: { request_id: response.headers.get('x-request-id') ?? requestId },
    })
  }
  return response
}

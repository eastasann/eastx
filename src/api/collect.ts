/**
 * 解析の受け口 `POST /api/collect`（SDD 5.14・ADR-023）。公開側の訪問者のブラウザが送るので CMS API（oRPC）の外に置き、
 * 5.1 のミドルウェアはかけない。書き込みは Analytics Engine だけで、中身のデータ（D1）は書かない（ADR-001 の例外）
 */
import { env } from 'cloudflare:workers'
import { getAuth, isAdminGithubUserId } from '../auth/server'
import { deviceOf, isBot } from '../domain/analytics/bots'
import { browserLanguageOf, countryOf, toDataPoint } from '../domain/analytics/data-point'
import { jstDateOf } from '../domain/analytics/dates'
import { MAX_EVENT_BYTES, parseEvent } from '../domain/analytics/events'
import { visitorHash } from '../domain/analytics/visitor'
import { captureServerError } from '../monitoring/server'
import { dailySalt } from './analytics/salt'
import { baseErrors } from './contract/common'
import { log } from './log'
import { rateLimitKeyOf } from './rate-limit-key'

type ErrorCode = 'INPUT_VALIDATION_FAILED' | 'FORBIDDEN' | 'TOO_MANY_REQUESTS'

/** 8章の形。oRPC の手続きの外なので defined は false。入力の誤りは 400（ブラウザは応答を読まないので欄の対応を返さない） */
function errorResponse(code: ErrorCode): Response {
  const status = code === 'INPUT_VALIDATION_FAILED' ? 400 : baseErrors[code].status
  return Response.json({ defined: false, code, status, message: baseErrors[code].message }, { status })
}

const accepted = () => new Response(null, { status: 204 })

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

/** 本文を上限まで読む。超えたら null。Content-Length は送り手が省けるので頼らない */
async function readLimited(request: Request): Promise<string | null> {
  if (request.body === null) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > MAX_EVENT_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

/** Better Auth のセッションの Cookie（本番は `__Secure-` 付き）。名前の接頭辞は src/auth/server.ts の cookiePrefix */
const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?eastx\.session_token=/

/** 管理者自身の閲覧か。セッションの Cookie が無ければ D1 を読まない */
async function isAdminVisit(headers: Headers): Promise<boolean> {
  if (!SESSION_COOKIE.test(headers.get('cookie') ?? '')) return false
  const session = await getAuth().api.getSession({ headers, query: { disableRefresh: true } })
  return session !== null && isAdminGithubUserId(env, session.user.githubUserId)
}

export async function handleCollect(request: Request, requestId: string): Promise<Response> {
  const siteUrl = new URL(env.SITE_URL)
  // ほかのサイトのページからの送信でデータが混ざるのを抑える。Origin の無い送信は受け付ける（付けないブラウザがありうる）
  const origin = request.headers.get('origin')
  if (origin !== null && origin !== siteUrl.origin) return errorResponse('FORBIDDEN')

  const text = await readLimited(request)
  const event = text === null ? null : parseEvent(text)
  if (event === null) return errorResponse('INPUT_VALIDATION_FAILED')

  const ipKey = rateLimitKeyOf(request.headers.get('cf-connecting-ip'))
  const { success } = await env.COLLECT_RATE_LIMITER.limit({ key: ipKey })
  if (!success) return errorResponse('TOO_MANY_REQUESTS')

  // 除外しても 204 を返し、除外したかどうかを外から見せない
  const userAgent = request.headers.get('user-agent')
  if (request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1') return accepted()
  if (userAgent === null || isBot(userAgent)) return accepted()
  if (await isAdminVisit(request.headers)) return accepted()

  // 計測するのは本番だけ（バインディングは wrangler.jsonc の本番にだけある）
  const dataset = env.ANALYTICS
  const salts = env.ANALYTICS_SALTS
  if (dataset === undefined || salts === undefined) return accepted()

  const date = jstDateOf(Date.now())
  const salt = await dailySalt(salts, date, (error) => {
    log('warn', { msg: 'salt put failed', requestId, route: 'POST /api/collect', error: errorText(error) })
  })
  const visitor = await visitorHash({ salt, date, ipKey, userAgent })
  const cf = (request as Request & { cf?: { country?: unknown } }).cf
  const point = toDataPoint(event, {
    visitor,
    country: countryOf(cf?.country),
    device: deviceOf(userAgent),
    browserLanguage: browserLanguageOf(request.headers.get('accept-language')),
    siteHost: siteUrl.hostname,
  })
  try {
    dataset.writeDataPoint(point)
  } catch (error) {
    // ブラウザはやり直さないので、500 を返しても結果は同じ。失敗は ERROR のログと Sentry で気づく
    log('error', { msg: 'writeDataPoint failed', requestId, route: 'POST /api/collect', error: errorText(error) })
    captureServerError(error, requestId)
  }
  return accepted()
}

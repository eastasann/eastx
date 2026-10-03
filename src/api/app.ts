/**
 * HTTP の入口（ADR-004）。`/api/*`・`/media/*` を Elysia で受け、
 * `/api/admin/*` は oRPC の OpenAPIHandler に、本文を Elysia に読ませずに渡す（skipBodyParsing）。
 * `/api/admin/*` の処理の順は SDD 5.1（リクエストID → CSRF → 認証 → レート制限 → 認可）。
 */
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { ORPCError } from '@orpc/server'
import { SimpleCsrfProtectionHandlerPlugin } from '@orpc/server/plugins'
import { Elysia } from 'elysia'
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker'
import { API_BASE_PATH } from './constants'
import { baseErrors } from './contract/common'
import { UPLOAD_MAX_BYTES } from './contract/misc'
import { clientInterceptors, handlerInterceptors, RequestBodyTooLargeError } from './errors'
import { log } from './log'
import { serveMedia } from './media'
import { router } from './router'

const rpcHandler = new OpenAPIHandler(router, {
  plugins: [
    new SimpleCsrfProtectionHandlerPlugin({
      error: new ORPCError('CSRF_TOKEN_MISMATCH', {
        status: baseErrors.CSRF_TOKEN_MISMATCH.status,
        message: baseErrors.CSRF_TOKEN_MISMATCH.message,
      }),
    }),
  ],
  interceptors: handlerInterceptors,
  clientInterceptors,
})

/**
 * 本文の上限。oRPC は手続きを決めたあと、CSRF・認証より前に本文を読み込む（multipart は全体をメモリーに載せる）ので、
 * 読む量そのものを上限で止める。Content-Length は送り手が省けるので頼らない。
 * アップロードの上限に、multipart の区切りと他の項目のぶんの余裕を足す
 */
const MAX_BODY_BYTES = UPLOAD_MAX_BYTES + 64 * 1024

function requestIdOf(request: Request): string {
  return request.headers.get('cf-ray') ?? crypto.randomUUID()
}

/** Cache API や fetch から得たレスポンスはヘッダーが変更できないので、作り直してから付ける */
function withRequestId(response: Response, requestId: string): Response {
  const result = new Response(response.body, response)
  result.headers.set('x-request-id', requestId)
  return result
}

function limitBody(request: Request): Request {
  if (request.body === null) return request
  const field = new URL(request.url).pathname === `${API_BASE_PATH}/uploads` ? 'file' : null
  let received = 0
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength
      if (received > MAX_BODY_BYTES) controller.error(new RequestBodyTooLargeError(field))
      else controller.enqueue(chunk)
    },
  })
  return new Request(request, { body: request.body.pipeThrough(limiter) })
}

async function handleAdmin(request: Request, requestId: string): Promise<Response> {
  const { pathname } = new URL(request.url)
  const { matched, response } = await rpcHandler.handle(limitBody(request), {
    prefix: API_BASE_PATH,
    context: {
      requestId,
      headers: request.headers,
      trace: { route: `${request.method} ${pathname}`, procedureStarted: false, detailedInput: false },
    },
  })
  if (matched) return response
  return notFound(request, requestId)
}

/**
 * 手続き・ルートが見つからない。oRPC のエラー形式に合わせる（SDD 8章。message は日本語）。
 * CSRF・認証より前に返す（存在しないパスに守るものはない。SDD 5.1）
 */
function notFound(request: Request, requestId: string): Response {
  const code = 'NOT_FOUND'
  const message = '見つかりませんでした'
  log('warn', { msg: message, requestId, route: `${request.method} ${new URL(request.url).pathname}`, code })
  return Response.json({ defined: false, code, status: 404, message }, { status: 404 })
}

/**
 * 本文を Elysia に読ませない parse の指定。aot: false の動的ハンドラーは parse: 'none' を解釈せず、
 * Content-Type に従って本文を読んでしまう（Elysia 1.4.30）。parse の関数が値を返すとそれを本文として扱い
 * 読み込みを飛ばすので、本文に触れずに印だけを返す。本文は受け渡した先（oRPC）が読む
 */
const BODY_NOT_PARSED = Symbol('body-not-parsed')
const skipBodyParsing = () => BODY_NOT_PARSED

// Workers は実行時のコード生成（new Function）を許さず、AOT の compile() が workerd で失敗するため
// aot: false で動かす（ADR-004 の代わりの案）
export const app = new Elysia({ adapter: CloudflareAdapter, aot: false })
  .all(
    '/api/admin/*',
    async ({ request }) => {
      const requestId = requestIdOf(request)
      return withRequestId(await handleAdmin(request, requestId), requestId)
    },
    { parse: skipBodyParsing },
  )
  .get('/media/*', async ({ request }) => withRequestId(await serveMedia(request), requestIdOf(request)))
  // 上のどれにも当たらないパス（src/server.ts が Elysia に渡す /api・/media の残り）にも x-request-id を付ける
  .all(
    '/*',
    ({ request }) => {
      const requestId = requestIdOf(request)
      return withRequestId(notFound(request, requestId), requestId)
    },
    { parse: skipBodyParsing },
  )

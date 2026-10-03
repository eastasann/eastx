/**
 * HTTP の入口（ADR-004）。`/api/*`・`/media/*` を Elysia で受け、
 * `/api/admin/*` は oRPC の OpenAPIHandler に本文を読ませずに渡す（parse: 'none'）。
 */
import { OpenAPIGenerator } from '@orpc/openapi'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { Elysia } from 'elysia'
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker'
import { contract } from './contract'
import { serveMedia } from './media'
import { router } from './router'

const rpcHandler = new OpenAPIHandler(router)

const openApiGenerator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
})

// Workers は実行時のコード生成（new Function）を許さず、AOT の compile() が workerd で失敗するため
// aot: false で動かす（ADR-004 の代わりの案）
export const app = new Elysia({ adapter: CloudflareAdapter, aot: false })
  // openapi.json はワイルドカードより先に登録する。このルートは oRPC のミドルウェアを通らないので、
  // Step 3 で認可（SDD 5.1。管理者だけ）を oRPC の手続きとは別にここへも必ず適用する（SDD 5.10）
  .get('/api/admin/openapi.json', () =>
    openApiGenerator.generate(contract, {
      info: { title: 'eastx CMS API', version: '1.0.0' },
    }),
  )
  .all(
    '/api/admin/*',
    async ({ request }) => {
      const { matched, response } = await rpcHandler.handle(request, { prefix: '/api/admin' })
      if (matched) return response
      // oRPC のエラー形式に合わせる（SDD 8章。message は日本語）
      return Response.json(
        { defined: false, code: 'NOT_FOUND', status: 404, message: '手続きが見つかりません' },
        { status: 404 },
      )
    },
    { parse: 'none' },
  )
  .get('/media/*', ({ request }) => serveMedia(request))

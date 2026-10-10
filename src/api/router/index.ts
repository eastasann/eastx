/**
 * コントラクトの実装。すべての手続きは base.ts の `admin`（認証・レート制限・認可を一律にかけた起点）から作る。
 */
import { OpenAPIGenerator } from '@orpc/openapi'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { API_BASE_PATH } from '../constants'
import { contract } from '../contract'
import { analytics } from './analytics'
import { admin } from './base'
import { blogPosts } from './blog-posts'
import { careers } from './careers'
import { codingLogs } from './coding-logs'
import { dashboard } from './dashboard'
import { privacyRouter } from './privacy'
import { profileRouter } from './profile'
import { projects } from './projects'
import { slugs } from './slugs'
import { stacks } from './stacks'
import { uploads } from './uploads'
import { works } from './works'

const openApiGenerator = new OpenAPIGenerator({ schemaConverters: [new ZodToJsonSchemaConverter()] })

const openapi = {
  // ほかの手続きと同じミドルウェアを通すため、仕様の出力も手続きにする（管理者だけ。SDD 5.10）
  get: admin.openapi.get.handler(async () => {
    const spec = await openApiGenerator.generate(contract, {
      info: { title: 'eastx CMS API', version: '1.0.0' },
      servers: [{ url: API_BASE_PATH }],
    })
    return spec as unknown as Record<string, unknown>
  }),
}

export const router = admin.router({
  dashboard,
  profile: profileRouter,
  careers,
  works,
  projects,
  stacks,
  blogPosts,
  codingLogs,
  privacy: privacyRouter,
  analytics,
  slugs,
  uploads,
  openapi,
})

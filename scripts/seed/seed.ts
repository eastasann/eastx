/**
 * ローカルの D1・R2 にデモデータを入れる（make db-seed ／ make db-seed-empty）。
 * wrangler の getPlatformProxy で、make dev と同じ .wrangler/state のバインディングを開く。
 * staging・本番には触れない（wrangler.jsonc のトップレベル = ローカルの設定だけを読む）。
 */
import { drizzle } from 'drizzle-orm/d1'
import { getPlatformProxy } from 'wrangler'
import * as schema from '../../src/db/schema'
import { buildSeed } from './data'
import { insertSeed } from './insert'

const empty = process.argv.includes('--empty')
const data = buildSeed({ empty })

// getPlatformProxy は environment を省くと CLOUDFLARE_ENV（make build の環境の選択）を読む。
// staging・本番の設定で開かないよう、設定されていれば止め、リモートのバインディングも使わない
if (process.env.CLOUDFLARE_ENV) {
  throw new Error(
    `CLOUDFLARE_ENV=${process.env.CLOUDFLARE_ENV} が設定されている。シードはローカルの D1・R2 にだけ入れる`,
  )
}
const proxy = await getPlatformProxy<Env>({ configPath: './wrangler.jsonc', persist: true, remoteBindings: false })
try {
  if (proxy.env.ENVIRONMENT !== 'local') {
    throw new Error(`ENVIRONMENT=${proxy.env.ENVIRONMENT} の設定を開いた。シードはローカルにだけ入れる`)
  }
  await Promise.all(
    data.images.map((img) =>
      proxy.env.MEDIA.put(img.key, img.body, { httpMetadata: { contentType: img.contentType } }),
    ),
  )
  await insertSeed(drizzle(proxy.env.DB, { schema }), data)
} finally {
  await proxy.dispose()
}

console.log(
  [
    `シードを入れた（${empty ? 'ブログ・コーディング記録なし' : '全件'}）:`,
    `profile ${data.profile.length}`,
    `social_link ${data.socialLinks.length}`,
    `career ${data.careers.length}`,
    `stack ${data.stacks.length}`,
    `work ${data.works.length}`,
    `project ${data.projects.length}`,
    `blog_post ${data.blogPosts.length}`,
    `coding_log ${data.codingLogs.length}`,
    `画像 ${data.images.length}`,
  ].join(' '),
)

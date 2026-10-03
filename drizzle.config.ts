import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'drizzle-kit'

// Drizzle Studio（make db-studio）が開くローカル D1 の実体。wrangler（make db-migrate）と
// Vite の Cloudflare プラグイン（make dev）は同じ .wrangler/state に置く。ファイル名は
// miniflare が database_id から決めるハッシュなので、ディレクトリから探す
const LOCAL_D1_DIR = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject'

function localD1Url(): string | undefined {
  if (!existsSync(LOCAL_D1_DIR)) return undefined
  const files = readdirSync(LOCAL_D1_DIR).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite')
  // D1 は eastx-db-local の1つだけ。複数あるとどれが今の DB か決められないので、黙って古い方を開かない
  if (files.length > 1) {
    throw new Error(`${LOCAL_D1_DIR} に D1 が複数ある（${files.join(', ')}）。make db-reset で作り直す`)
  }
  const [file] = files
  return file === undefined ? undefined : `file:${join(LOCAL_D1_DIR, file)}`
}

const url = localD1Url()
// generate は DB に触れないので、ローカル D1 が無くても通す。studio だけが DB を要る
if (url === undefined && process.argv.includes('studio')) {
  throw new Error(`ローカル D1 が見つからない（${LOCAL_D1_DIR}）。先に make db-migrate を実行する`)
}

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
  ...(url === undefined ? {} : { dbCredentials: { url } }),
})

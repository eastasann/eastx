import { applyD1Migrations, type D1Migration, env } from 'cloudflare:test'

// TEST_MIGRATIONS は vitest.config.ts がテストにだけ渡すバインディング。Cloudflare.Env に足すと
// アプリのコードからも見えてしまうので、ここでだけ型を付ける
const { TEST_MIGRATIONS } = env as Cloudflare.Env & { TEST_MIGRATIONS: D1Migration[] }

// 適用済みのマイグレーションは d1_migrations に記録されるので、同じファイルの中で何度呼ばれても当て直さない
await applyD1Migrations(env.DB, TEST_MIGRATIONS)

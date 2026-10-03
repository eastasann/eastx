import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
        },
      },
      {
        plugins: [
          cloudflareTest(async () => ({
            // バインディングは wrangler.jsonc（トップレベル = ローカル）から読む。
            // main は wrangler.jsonc から継承させない: src/server.ts は TanStack Start の
            // 仮想モジュールに依存し、Vite のビルドの外ではバンドルできない。
            // テストは Elysia のアプリ（src/api/app.ts）を直接呼ぶので、main は空の Worker でよい
            main: './tests/integration/entry.ts',
            wrangler: { configPath: './wrangler.jsonc' },
            // pool が同梱する workerd は 2026-08-22 までしか対応しない。
            // wrangler.jsonc の compatibility_date（2026-09-01）はそのままに、テストだけ上限に合わせる。
            // pool の更新で外せるようになったら外す
            miniflare: {
              compatibilityDate: '2026-08-22',
              // テストファイルごとに空の D1 へ当てる（tests/integration/setup.ts）。docs/03_dev-setup.md 7章
              bindings: { TEST_MIGRATIONS: await readD1Migrations('./drizzle/migrations') },
            },
          })),
        ],
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['./tests/integration/setup.ts'],
        },
      },
    ],
  },
})

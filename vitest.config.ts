import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 行カバレッジの目標は SDD 10章。対象は純粋関数の層だけで、ユニットテストで測る。
    // v8 のカバレッジは workerd の上で動かない（node:inspector が無い）ので、make test は
    // unit の project にだけ --coverage を付けて走らせる
    coverage: {
      provider: 'v8',
      include: ['src/domain/**/*.ts', 'src/i18n/**/*.ts', 'src/markdown/**/*.ts'],
      exclude: ['**/*.test.ts'],
      reporter: ['text'],
      // ディレクトリごとに測り、ほかのディレクトリの高さで1つの不足が隠れないようにする
      thresholds: {
        'src/domain/**': { lines: 90 },
        'src/i18n/**': { lines: 90 },
        'src/markdown/**': { lines: 90 },
      },
    },
    projects: [
      {
        // src/ の ~/ の別名（tsconfig.json の paths）を vite.config.ts と同じ方法で解決する
        resolve: { tsconfigPaths: true },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
        },
      },
      {
        resolve: { tsconfigPaths: true },
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
              bindings: {
                // テストファイルごとに空の D1 へ当てる（tests/integration/setup.ts）。docs/03_dev-setup.md 7章
                TEST_MIGRATIONS: await readD1Migrations('./drizzle/migrations'),
                // 手元の .dev.vars（CI には無い）に左右されないよう、認証に使う値はテストで固定する
                ADMIN_GITHUB_USER_ID: '1000001',
                BETTER_AUTH_SECRET: 'test-secret-for-integration-tests-only-0123456789',
                GITHUB_CLIENT_ID: 'test-client-id',
                GITHUB_CLIENT_SECRET: 'test-client-secret',
              },
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

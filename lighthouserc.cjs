// Lighthouse CI（SDD 10章）。make e2e がビルドしたもののプレビューを、デモデータを入れたローカルの D1 で測り、
// PRD 5章の Lighthouse の目標を assert する。設定はモバイル（Lighthouse の既定）。結果はどこにもアップロードしない
const { chromium } = require('@playwright/test')

const BASE = 'http://localhost:3000'

module.exports = {
  ci: {
    collect: {
      // P1 と、P2〜P5 の各1ページ（PRD 5章）
      url: [
        `${BASE}/ja`,
        `${BASE}/ja/works/portfolio-cms`,
        `${BASE}/ja/projects/payment-renewal`,
        `${BASE}/ja/blog/hello-eastx`,
        `${BASE}/ja/coding/learn-elysia`,
      ],
      // 1回ごとのばらつきを中央値でならす
      numberOfRuns: 3,
      // 本番の拠点と同じく圧縮して返す（scripts/lhci/server.ts）
      startServerCommand: 'bun scripts/lhci/server.ts',
      startServerReadyPattern: 'lhci server ready',
      startServerReadyTimeout: 60000,
      // make setup・CI が入れた Playwright の Chromium を使う（別に Chrome を入れない）
      chromePath: chromium.executablePath(),
      settings: {
        chromeFlags: '--headless=new --no-sandbox',
        // ローカルと staging の robots.txt はすべてを拒否する（ADR-019）ので、検索の対象から外れる判定は
        // 環境による意図した結果。本番の robots.txt は公開側のページを拒否しない（src/content/robots.ts の単体テスト）
        skipAudits: ['is-crawlable'],
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9, aggregationMethod: 'median-run' }],
        'categories:accessibility': ['error', { minScore: 0.95, aggregationMethod: 'median-run' }],
        'categories:best-practices': ['error', { minScore: 0.95, aggregationMethod: 'median-run' }],
        'categories:seo': ['error', { minScore: 0.95, aggregationMethod: 'median-run' }],
      },
    },
  },
}

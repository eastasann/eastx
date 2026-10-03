// vitest-pool-workers の main に渡すテスト専用の空の Worker。
// 本物の入口（src/server.ts）は TanStack Start の仮想モジュールに依存して
// Vite のビルドの外ではバンドルできないため、テストはここを main にして
// Elysia のアプリを直接 import して呼ぶ
export default {
  fetch(): Response {
    return new Response(null, { status: 404 })
  },
}

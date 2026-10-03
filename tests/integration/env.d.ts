/// <reference types="@cloudflare/vitest-pool-workers/types" />

// cloudflare:test の env に wrangler.jsonc のバインディングの型を付ける
declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}

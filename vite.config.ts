import { cloudflare } from '@cloudflare/vite-plugin'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  server: { port: 3000 },
  build: {
    // 小さいフォントのサブセットも data: URI にせずファイルで配信する。CSP（SDD 7章）は font-src を
    // default-src 'self' に任せていて、data: のフォントは読み込みを拒まれる
    assetsInlineLimit: (filePath) => (/\.woff2?$/.test(filePath) ? false : undefined),
  },
  resolve: { tsconfigPaths: true },
  plugins: [cloudflare({ viteEnvironment: { name: 'ssr' } }), tanstackStart(), viteReact()],
})

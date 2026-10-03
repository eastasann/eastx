/**
 * サイトの origin。C1・C2 の og:image の絶対 URL に使う（ADR-019）。サーバーは SITE_URL から作る。
 * ブラウザでの移動で作る <head> はクローラーが読まないので、ブラウザでは開いているページの origin を使う
 * （公開側のページは SITE_URL で配信しているので同じ値になる）
 */
import { env } from 'cloudflare:workers'
import { createIsomorphicFn } from '@tanstack/react-start'

export const siteOrigin = createIsomorphicFn()
  .server(() => new URL(env.SITE_URL).origin)
  .client(() => window.location.origin)

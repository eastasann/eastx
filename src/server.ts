/**
 * Worker の入口（ADR-001）。`/api/*` と `/media/*` を Elysia へ、それ以外を TanStack Start へ振り分ける。
 * バインディングと環境変数は `cloudflare:workers` の env から読む（fetch の引数を引き回さない）。
 */
import startHandler from '@tanstack/react-start/server-entry'
import { app } from './api/app'

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname === '/media' || pathname.startsWith('/media/')
}

export default {
  fetch(request) {
    const { pathname } = new URL(request.url)
    if (isApiPath(pathname)) return app.fetch(request)
    return startHandler.fetch(request)
  },
} satisfies ExportedHandler

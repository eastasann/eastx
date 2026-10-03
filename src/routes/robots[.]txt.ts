import { env } from 'cloudflare:workers'
import { createFileRoute } from '@tanstack/react-router'
import { robotsTxt } from '~/content/robots'

// 静的ファイルにせず、環境ごとに中身を変える（ADR-019、SDD 4.2）
export const Route = createFileRoute('/robots.txt')({
  server: {
    handlers: {
      GET: () => new Response(robotsTxt(env.ENVIRONMENT), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }),
    },
  },
})

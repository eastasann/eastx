/**
 * 公開側のサーバー関数（SDD 5.11）。読み取りの本体は各ファイルの load* にあり、ここは D1 をつないで公開するだけ。
 * load* を分けているのは、TanStack Start の外（Workers の結合テスト）から同じ読み取りを呼ぶため
 */

import { env } from 'cloudflare:workers'
import { isNotFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { getDb } from '~/db/client'
import { loadSiteChrome } from './site-chrome'

/**
 * 失敗をログに出し、中身を伏せた例外に置き換えて投げる（SDD 8章）。TanStack Start は投げた例外のメッセージを
 * SSR の HTML とサーバー関数の応答に載せてブラウザへ渡すので、D1 のエラーの文面をそのまま投げない。
 * notFound()（C1）はそのまま通す
 */
async function guarded<T>(route: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if (isNotFound(error)) throw error
    const requestId = getRequestHeader('cf-ray') ?? crypto.randomUUID()
    console.error(JSON.stringify({ level: 'error', msg: 'public read failed', requestId, route, error: String(error) }))
    throw new Error('INTERNAL_SERVER_ERROR')
  }
}

export const getSiteChrome = createServerFn({ method: 'GET' }).handler(() =>
  guarded('getSiteChrome', () => loadSiteChrome(getDb(env))),
)

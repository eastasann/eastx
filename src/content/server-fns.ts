/**
 * 公開側のサーバー関数（SDD 5.11）。読み取りの本体は各ファイルの load* にあり、ここは D1 をつないで公開するだけ。
 * load* を分けているのは、TanStack Start の外（Workers の結合テスト）から同じ読み取りを呼ぶため。
 * サーバー関数は誰でも呼べる HTTP エンドポイントになるので、入力は必ず検証する（SDD 7章）。
 * 公開側のバンドルに Zod を入れない方針のため、検証は素の関数で書く（ADR-008）
 */

import { env } from 'cloudflare:workers'
import { isNotFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { getDb } from '~/db/client'
import { isSlug } from '~/domain/slug'
import { isLang, type Lang } from '~/i18n/detect'
import { type DetailInput, loadProjectDetail, loadWorkDetail } from './portfolio-detail'
import { loadBlogPost, loadCodingLog } from './post-detail'
import type { ContentContext } from './shared'
import { loadSiteChrome } from './site-chrome'
import { loadTopPage } from './top-page'

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

function contentContext(): ContentContext {
  return { db: getDb(env), siteUrl: env.SITE_URL }
}

function validateLang(input: unknown): Lang {
  if (typeof input !== 'string' || !isLang(input)) throw new Error('lang は ja か en')
  return input
}

function validateTopInput(input: unknown): { lang: Lang } {
  if (typeof input !== 'object' || input === null) throw new Error('入力は { lang }')
  return { lang: validateLang((input as Record<string, unknown>).lang) }
}

/** スラッグの形でないものはルートのローダーが C1 にするので、ここに来るのは直接の呼び出しだけ */
function validateDetailInput(input: unknown): DetailInput {
  if (typeof input !== 'object' || input === null) throw new Error('入力は { lang, slug }')
  const { lang, slug } = input as Record<string, unknown>
  if (typeof slug !== 'string' || !isSlug(slug)) throw new Error('slug の形が正しくない')
  return { lang: validateLang(lang), slug }
}

export const getSiteChrome = createServerFn({ method: 'GET' }).handler(() =>
  guarded('getSiteChrome', () => loadSiteChrome(getDb(env))),
)

export const getTopPage = createServerFn({ method: 'GET' })
  .validator(validateTopInput)
  .handler(({ data }) => guarded('getTopPage', () => loadTopPage(contentContext(), data.lang)))

export const getWorkDetail = createServerFn({ method: 'GET' })
  .validator(validateDetailInput)
  .handler(({ data }) => guarded('getWorkDetail', () => loadWorkDetail(contentContext(), data)))

export const getProjectDetail = createServerFn({ method: 'GET' })
  .validator(validateDetailInput)
  .handler(({ data }) => guarded('getProjectDetail', () => loadProjectDetail(contentContext(), data)))

export const getBlogPost = createServerFn({ method: 'GET' })
  .validator(validateDetailInput)
  .handler(({ data }) => guarded('getBlogPost', () => loadBlogPost(contentContext(), data)))

export const getCodingLog = createServerFn({ method: 'GET' })
  .validator(validateDetailInput)
  .handler(({ data }) => guarded('getCodingLog', () => loadCodingLog(contentContext(), data)))

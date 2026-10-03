/**
 * Markdown の描画結果の Cache API（ADR-011）。公開側のサーバー関数（src/content/）だけが使う。
 * キーに RENDER_VERSION と updated_at を含むので、中身を保存しても描画の処理を変えても別のキーになり、
 * 古い結果を消す必要がない。Cache API は拠点ごとなので、拠点で最初のアクセスは描画からやり直す。
 */
import type { Lang } from '../i18n/detect'
import { RENDER_VERSION, type RenderOptions, renderMarkdown } from './render'

/** 本文を持つ中身の種類 */
export type MarkdownKind = 'profile' | 'career' | 'work' | 'project' | 'blog-post' | 'coding-log'

export interface MarkdownSource {
  kind: MarkdownKind
  id: string
  /** 本文の言語（代替したときは、実際に出す本文の言語） */
  lang: Lang
  /** 中身の updated_at（UNIX ミリ秒） */
  updatedAt: number
  markdown: string
}

const MAX_AGE_SECONDS = 7 * 24 * 60 * 60

// tsconfig は DOM の型も読むので、caches の型は DOM の CacheStorage（default がない）になる。
// 実行するのは Workers なので、Workers の caches.default として読む
const workersCaches = (): { default: Cache } => caches as unknown as { default: Cache }

export function cacheKey(source: Pick<MarkdownSource, 'kind' | 'id' | 'lang' | 'updatedAt'>): string {
  const id = encodeURIComponent(source.id)
  return `https://md-cache.internal/${RENDER_VERSION}/${source.kind}/${id}/${source.lang}/${source.updatedAt}`
}

/**
 * 描画結果をキャッシュから返し、なければ描画して保存する。
 * キャッシュの読み書きに失敗しても、描画した結果は返す（キャッシュは速さのためだけのもの）
 */
export async function renderMarkdownCached(
  source: MarkdownSource,
  options: Omit<RenderOptions, 'lang'>,
  cache: Cache = workersCaches().default,
): Promise<string> {
  const key = cacheKey(source)
  const hit = await cache.match(key).catch((error: unknown) => {
    console.error(JSON.stringify({ level: 'error', msg: 'markdown cache read failed', key, error: String(error) }))
    return undefined
  })
  if (hit) return hit.text()
  const html = await renderMarkdown(source.markdown, { ...options, lang: source.lang })
  const response = new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': `max-age=${MAX_AGE_SECONDS}` },
  })
  await cache.put(key, response).catch((error: unknown) => {
    console.error(JSON.stringify({ level: 'error', msg: 'markdown cache write failed', key, error: String(error) }))
  })
  return html
}

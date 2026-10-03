import { describe, expect, it, vi } from 'vitest'
import { cacheKey, type MarkdownSource, renderMarkdownCached } from './cache'
import { RENDER_VERSION } from './render'

const SOURCE: MarkdownSource = {
  kind: 'blog-post',
  id: 'abc',
  lang: 'en',
  updatedAt: 1_700_000_000_000,
  markdown: '# Title',
}

/** Workers の Cache API のうち、使う2つだけを持つ代わり */
function memoryCache() {
  const store = new Map<string, Response>()
  const cache = {
    match: vi.fn(async (key: string) => store.get(key)?.clone()),
    put: vi.fn(async (key: string, response: Response) => {
      store.set(key, response)
    }),
  }
  return { cache, store, asCache: cache as unknown as Cache }
}

describe('cacheKey', () => {
  it('RENDER_VERSION・種類・ID・言語・updated_at を含む', () => {
    expect(cacheKey(SOURCE)).toBe(`https://md-cache.internal/${RENDER_VERSION}/blog-post/abc/en/1700000000000`)
  })

  it('ID は URL のパスとして安全な形にする', () => {
    expect(cacheKey({ ...SOURCE, id: 'a/b?c' })).toContain('/a%2Fb%3Fc/')
  })
})

describe('renderMarkdownCached', () => {
  it('なければ描画して7日のキャッシュに入れ、次はキャッシュから返す', async () => {
    const { cache, store, asCache } = memoryCache()
    const first = await renderMarkdownCached(SOURCE, {}, asCache)
    expect(first).toBe('<h2>Title</h2>')
    const saved = store.get(cacheKey(SOURCE))
    expect(saved?.headers.get('Cache-Control')).toBe('max-age=604800')

    store.set(cacheKey(SOURCE), new Response('<p>cached</p>'))
    expect(await renderMarkdownCached(SOURCE, {}, asCache)).toBe('<p>cached</p>')
    expect(cache.put).toHaveBeenCalledTimes(1)
  })

  it('updated_at が変われば別のキーで描画し直す', async () => {
    const { store, asCache } = memoryCache()
    store.set(cacheKey(SOURCE), new Response('<p>old</p>'))
    const html = await renderMarkdownCached({ ...SOURCE, updatedAt: SOURCE.updatedAt + 1 }, {}, asCache)
    expect(html).toBe('<h2>Title</h2>')
  })

  it('キャッシュの読み書きに失敗しても描画した結果を返す', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = {
      match: async () => {
        throw new Error('read')
      },
      put: async () => {
        throw new Error('write')
      },
    } as unknown as Cache
    expect(await renderMarkdownCached(SOURCE, {}, broken)).toBe('<h2>Title</h2>')
    expect(errors).toHaveBeenCalledTimes(2)
    errors.mockRestore()
  })
})

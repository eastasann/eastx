import { describe, expect, it, vi } from 'vitest'
import { cacheKey, type MarkdownSource, renderMarkdownCached, stacksVersion } from './cache'
import { type MarkdownStack, RENDER_VERSION } from './render'

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

  it('使用技術の版を渡したときだけ、末尾に /s-{版} を足す', () => {
    expect(cacheKey(SOURCE, '3f9a1c0b')).toBe(
      `https://md-cache.internal/${RENDER_VERSION}/blog-post/abc/en/1700000000000/s-3f9a1c0b`,
    )
    expect(cacheKey(SOURCE).endsWith('/')).toBe(false)
  })
})

describe('stacksVersion', () => {
  const REACT: MarkdownStack = { key: 'react', displayName: 'React', iconUrl: '/media/react.svg' }
  const GO: MarkdownStack = { key: 'go', displayName: 'Go', iconUrl: null }

  it('SHA-256 の先頭8桁の16進', async () => {
    expect(await stacksVersion([REACT, GO])).toMatch(/^[0-9a-f]{8}$/)
  })

  it('並び（sort_order）と、照合に使わない項目（show_on_top など）では変わらない', async () => {
    const base = await stacksVersion([REACT, GO])
    expect(await stacksVersion([GO, REACT])).toBe(base)
    const withExtra = [{ ...REACT, showOnTop: false, sortOrder: 9 }, GO]
    expect(await stacksVersion(withExtra)).toBe(base)
  })

  it('追加・削除・表示名・識別名・アイコンの変更で変わる', async () => {
    const base = await stacksVersion([REACT, GO])
    const changed = await Promise.all([
      stacksVersion([REACT, GO, { key: 'bun', displayName: 'Bun', iconUrl: null }]),
      stacksVersion([REACT]),
      stacksVersion([{ ...REACT, displayName: 'React.js' }, GO]),
      stacksVersion([{ ...REACT, key: 'reactjs' }, GO]),
      stacksVersion([{ ...REACT, iconUrl: '/media/react2.svg' }, GO]),
      stacksVersion([REACT, { ...GO, iconUrl: '/media/go.svg' }]),
    ])
    for (const version of changed) expect(version).not.toBe(base)
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

  it('使用技術を渡した描画は版付きのキーに入り、使用技術が変われば描画し直す', async () => {
    const { store, asCache } = memoryCache()
    const source = { ...SOURCE, markdown: '**React**' }
    const react: MarkdownStack = { key: 'react', displayName: 'React', iconUrl: '/media/react.svg' }
    const first = await renderMarkdownCached(source, { stacks: [react] }, asCache)
    expect(first).toContain('src="/media/react.svg"')
    expect(store.has(cacheKey(source, await stacksVersion([react])))).toBe(true)
    expect(store.has(cacheKey(source))).toBe(false)

    const moved = { ...react, iconUrl: '/media/react-new.svg' }
    expect(await renderMarkdownCached(source, { stacks: [moved] }, asCache)).toContain('src="/media/react-new.svg"')
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

/**
 * Markdown の描画を workerd の上で確かめる（ADR-011・012）。Shiki の JavaScript の正規表現エンジンと
 * Cache API（caches.default）は、Node.js のユニットテストでは本物を通らないので、ここで通す。
 */
import { describe, expect, it } from 'vitest'
import { cacheKey, type MarkdownSource, renderMarkdownCached } from '../../src/markdown/cache'

const SOURCE: MarkdownSource = {
  kind: 'coding-log',
  id: crypto.randomUUID(),
  lang: 'ja',
  updatedAt: Date.now(),
  markdown: '## 見出し\n\n```ts\nconst a: number = 1\n```',
}

describe('workerd での描画', () => {
  it('Shiki で色分けし、caches.default に入れる', async () => {
    const html = await renderMarkdownCached(SOURCE, { siteOrigin: 'http://localhost' })
    expect(html).toContain('<h3>見出し</h3>')
    expect(html.match(/<span style="--shiki-light:/g)?.length).toBeGreaterThan(1)

    // tsconfig が DOM の型も読むため、Workers の caches.default として読む（src/markdown/cache.ts と同じ）
    const cached = await (caches as unknown as { default: Cache }).default.match(cacheKey(SOURCE))
    expect(await cached?.text()).toBe(html)
  })
})

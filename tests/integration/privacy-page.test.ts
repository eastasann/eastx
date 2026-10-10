/**
 * 公開側のプライバシーのページ（SDD 5.11 の getPrivacyPage と SiteChromeView.hasPrivacyPage、ADR-019 の P6 のメタ）。
 * 行が無い・本文が日英とも空ならページもリンクも無いこと、言語の代替、メタ、Markdown のキャッシュの種類を確かめる
 */
import { env } from 'cloudflare:test'
import { isNotFound } from '@tanstack/react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadPrivacyPage } from '../../src/content/privacy-page'
import type { ContentContext } from '../../src/content/shared'
import { getDb } from '../../src/db/client'
import { privacyPage } from '../../src/db/schema'
import { cacheKey } from '../../src/markdown/cache'
import { pageHead } from '../../src/site/head'

const db = getDb(env)
const SITE_URL = 'https://x.eastasian.dev'
const context: ContentContext = { db, siteUrl: SITE_URL }

beforeEach(async () => {
  await db.delete(privacyPage)
})

async function expectNotFound(read: Promise<unknown>): Promise<void> {
  const error = await read.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(isNotFound(error)).toBe(true)
}

describe('loadPrivacyPage', () => {
  it('行が無い・本文が日英とも空なら notFound（C1）', async () => {
    await expectNotFound(loadPrivacyPage(context, 'ja'))
    await db.insert(privacyPage).values({ bodyJa: null, bodyEn: null })
    await expectNotFound(loadPrivacyPage(context, 'ja'))
    await expectNotFound(loadPrivacyPage(context, 'en'))
  })

  it('日英とも本文があれば、表示中の言語の本文と行の updated_at を返す', async () => {
    const updatedAt = new Date('2026-10-10T03:12:45.000Z')
    await db.insert(privacyPage).values({ bodyJa: '## 集めるもの\n\n閲覧数', bodyEn: '## What\n\nViews', updatedAt })
    const ja = await loadPrivacyPage(context, 'ja')
    expect(ja.lang).toBe('ja')
    expect(ja.body.lang).toBe('ja')
    expect(ja.body.html).toContain('集めるもの')
    expect(ja.updatedAt).toBe('2026-10-10T03:12:45.000Z')
    const en = await loadPrivacyPage(context, 'en')
    expect(en.body.lang).toBe('en')
    expect(en.body.html).toContain('What')
    // 最終更新日は日英で同じ（1つの文書として扱う）
    expect(en.updatedAt).toBe(ja.updatedAt)
  })

  it('片方の言語だけなら、もう片方の言語の本文で出し、body.lang がその言語になる', async () => {
    await db.insert(privacyPage).values({ bodyJa: '日本語の本文です。', bodyEn: null })
    const en = await loadPrivacyPage(context, 'en')
    expect(en.lang).toBe('en')
    expect(en.body).toEqual({ html: expect.stringContaining('日本語の本文です。'), lang: 'ja' })
  })

  it('メタ: タイトルは辞書の文言とサイト名、説明は出している本文の抜粋、既定の画像、言語ごとの URL', async () => {
    await db.insert(privacyPage).values({ bodyJa: '## 集めるもの\n\nアクセスを集計しています。', bodyEn: null })
    const ja = await loadPrivacyPage(context, 'ja')
    expect(ja.meta).toEqual({
      title: 'プライバシー — eastasian',
      description: '集めるもの アクセスを集計しています。',
      ogImageUrl: `${SITE_URL}/og/default-ja.png`,
      alternates: { ja: `${SITE_URL}/ja/privacy`, en: `${SITE_URL}/en/privacy` },
    })
    // 英語のページでも、説明は出している本文（日本語）の抜粋
    const en = await loadPrivacyPage(context, 'en')
    expect(en.meta.title).toBe('Privacy — eastasian')
    expect(en.meta.description).toBe('集めるもの アクセスを集計しています。')
    expect(en.meta.ogImageUrl).toBe(`${SITE_URL}/og/default-en.png`)
  })

  it('片方の言語しか本文が無くても、canonical と hreflang の ja・en・x-default を出す', async () => {
    await db.insert(privacyPage).values({ bodyJa: null, bodyEn: 'English only.' })
    const view = await loadPrivacyPage(context, 'ja')
    expect(pageHead(view.lang, view.meta).links).toEqual([
      { rel: 'canonical', href: `${SITE_URL}/ja/privacy` },
      { rel: 'alternate', hrefLang: 'ja', href: `${SITE_URL}/ja/privacy` },
      { rel: 'alternate', hrefLang: 'en', href: `${SITE_URL}/en/privacy` },
      { rel: 'alternate', hrefLang: 'x-default', href: `${SITE_URL}/` },
    ])
  })

  it('本文の描画結果は Markdown のキャッシュに種類 privacy・行の id で入る', async () => {
    const id = crypto.randomUUID()
    const updatedAt = new Date('2026-10-01T00:00:00.000Z')
    await db.insert(privacyPage).values({ id, bodyJa: '本文', bodyEn: null, updatedAt })
    const key = cacheKey({ kind: 'privacy', id, lang: 'ja', updatedAt: updatedAt.getTime() })
    expect(key).toContain('/privacy/')
    // 同じキーに目印を置き、描画がそれを返す（同じキーを引く）ことを見る
    const cache = (caches as unknown as { default: Cache }).default
    await cache.put(key, new Response('<p>cached</p>', { headers: { 'cache-control': 'max-age=60' } }))
    expect((await loadPrivacyPage(context, 'ja')).body.html).toBe('<p>cached</p>')
  })
})

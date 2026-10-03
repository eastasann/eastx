/**
 * ブログ記事・コーディング記録（SDD 5.9）。公開状態の遷移と日時のカラム（SDD 5.3）を中心に確かめる。
 */
import { env } from 'cloudflare:test'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { getDb } from '../../src/db/client'
import { blogPost } from '../../src/db/schema'
import { type AdminClient, byId, call, createClient, createSession } from './helpers'

let client: AdminClient
let cookie: string

beforeAll(async () => {
  ;({ cookie } = await createSession({ admin: true }))
  client = createClient(cookie)
})

function blogInput(slug: string, overrides: Partial<Parameters<AdminClient['blogPosts']['create']>[0]> = {}) {
  return {
    status: 'draft' as const,
    slug,
    ja: { title: 'タイトル', body: '本文' },
    en: { title: null, body: null },
    thumbnailUrl: null,
    publishedAt: null,
    ...overrides,
  }
}

/** 保存のあいだの時刻の差がミリ秒単位で見えるよう、少し待つ */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

describe('ブログ記事の公開状態の遷移と日時', () => {
  it('下書き → 公開 → 更新 → 非公開 → 再公開', async () => {
    const draft = await client.blogPosts.create(blogInput('lifecycle'))
    expect(draft).toMatchObject({ status: 'draft', publishedAt: null, contentUpdatedAt: null })

    // 公開日が空のまま公開すると今の日時
    await tick()
    const published = await client.blogPosts.update(byId(draft.id, { ...blogInput('lifecycle'), status: 'published' }))
    expect(published.publishedAt).not.toBeNull()
    expect(published.contentUpdatedAt).toBeNull()

    // 公開中に本文を変えて「更新する」と、更新日が入る
    await tick()
    const changed = await client.blogPosts.update(
      byId(draft.id, {
        ...blogInput('lifecycle'),
        status: 'published',
        publishedAt: published.publishedAt,
        ja: { title: 'タイトル', body: '本文を直した' },
      }),
    )
    expect(changed.publishedAt).toBe(published.publishedAt)
    expect(changed.contentUpdatedAt).not.toBeNull()

    // タイトルも本文も同じなら、更新日は変えない
    await tick()
    const same = await client.blogPosts.update(
      byId(draft.id, {
        ...blogInput('lifecycle'),
        status: 'published',
        publishedAt: published.publishedAt,
        ja: { title: 'タイトル', body: '本文を直した' },
        thumbnailUrl: '/media/uploads/2026/10/t.png',
      }),
    )
    expect(same.contentUpdatedAt).toBe(changed.contentUpdatedAt)

    // 非公開に戻しても公開日は残り、非公開のあいだの変更では更新日を変えない
    await tick()
    const unpublished = await client.blogPosts.update(
      byId(draft.id, {
        ...blogInput('lifecycle'),
        status: 'draft',
        publishedAt: published.publishedAt,
        ja: { title: 'タイトル', body: '非公開のあいだに直した' },
      }),
    )
    expect(unpublished.status).toBe('draft')
    expect(unpublished.publishedAt).toBe(published.publishedAt)
    expect(unpublished.contentUpdatedAt).toBe(changed.contentUpdatedAt)

    // もう一度公開しても公開日は変えない
    await tick()
    const republished = await client.blogPosts.update(
      byId(draft.id, {
        ...blogInput('lifecycle'),
        status: 'published',
        publishedAt: published.publishedAt,
        ja: { title: 'タイトル', body: '非公開のあいだに直した' },
      }),
    )
    expect(republished.publishedAt).toBe(published.publishedAt)
    expect(republished.contentUpdatedAt).toBe(changed.contentUpdatedAt)
  })

  it('公開日は、一度も公開していなければ受け付けず、今より後にできず、公開後は空にできない', async () => {
    const past = '2026-01-15T03:00:00.000Z'
    await expect(client.blogPosts.create(blogInput('dates', { publishedAt: past }))).rejects.toMatchObject({
      code: 'INPUT_VALIDATION_FAILED',
      data: { fieldErrors: { publishedAt: ['公開日は公開した後に入れられます'] } },
    })

    const published = await client.blogPosts.create(blogInput('dates', { status: 'published' }))
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    await expect(
      client.blogPosts.update(
        byId(published.id, {
          ...blogInput('dates', { status: 'published', publishedAt: future }),
        }),
      ),
    ).rejects.toMatchObject({
      code: 'INPUT_VALIDATION_FAILED',
      data: { fieldErrors: { publishedAt: expect.any(Array) } },
    })
    await expect(
      client.blogPosts.update(byId(published.id, { ...blogInput('dates', { status: 'draft' }) })),
    ).rejects.toMatchObject({
      code: 'INPUT_VALIDATION_FAILED',
      data: { fieldErrors: { publishedAt: expect.any(Array) } },
    })

    // 公開後は直せる。オフセット付きの値も受け付け、UTC の ISO 8601 で返す
    const edited = await client.blogPosts.update(
      byId(published.id, {
        ...blogInput('dates', { status: 'published', publishedAt: '2026-01-15T12:00:00+09:00' }),
      }),
    )
    expect(edited.publishedAt).toBe(past)
  })

  it('公開には言語あり（タイトルと本文）とスラッグが要る。足りない項目は言語付きで返す', async () => {
    await expect(
      client.blogPosts.create(
        blogInput('', { status: 'published', slug: null, ja: { title: 'タイトルだけ', body: null } }),
      ),
    ).rejects.toMatchObject({
      code: 'PUBLISH_REQUIREMENTS_NOT_MET',
      data: { missing: [{ field: 'body', lang: 'ja' }, { field: 'slug' }] },
    })
  })

  it('公開日の空文字は空（null）として受け付ける', async () => {
    const post = await client.blogPosts.create(blogInput('empty-date', { publishedAt: '' }))
    expect(post.publishedAt).toBeNull()
  })

  it('タイトルのない公開は、下書きのルールではなく公開のルールの足りない項目として返す', async () => {
    await expect(
      client.blogPosts.create(blogInput('no-title', { status: 'published', ja: { title: null, body: '本文だけ' } })),
    ).rejects.toMatchObject({
      code: 'PUBLISH_REQUIREMENTS_NOT_MET',
      data: { missing: [{ field: 'title', lang: 'ja' }] },
    })
    // 下書きでは入力の誤り
    await expect(
      client.blogPosts.create(blogInput('no-title', { ja: { title: null, body: '本文だけ' } })),
    ).rejects.toMatchObject({ code: 'INPUT_VALIDATION_FAILED' })
  })

  it('スラッグの重複は SLUG_CONFLICT', async () => {
    await client.blogPosts.create(blogInput('dup-post'))
    await expect(client.blogPosts.create(blogInput('dup-post'))).rejects.toMatchObject({
      code: 'SLUG_CONFLICT',
      data: { suggestion: 'dup-post-2' },
    })
  })

  it('一覧は下書きを最終保存日の新しい順で先頭に、続けて公開中を公開日の新しい順', async () => {
    const db = getDb(env)
    const a = await client.blogPosts.create(blogInput('order-published-old', { status: 'published' }))
    const b = await client.blogPosts.create(blogInput('order-published-new', { status: 'published' }))
    const c = await client.blogPosts.create(blogInput('order-draft-old'))
    const d = await client.blogPosts.create(blogInput('order-draft-new'))
    await db
      .update(blogPost)
      .set({ publishedAt: new Date('2026-01-01T00:00:00Z') })
      .where(eq(blogPost.id, a.id))
    await db
      .update(blogPost)
      .set({ publishedAt: new Date('2026-02-01T00:00:00Z') })
      .where(eq(blogPost.id, b.id))
    await db
      .update(blogPost)
      .set({ updatedAt: new Date('2026-03-01T00:00:00Z') })
      .where(eq(blogPost.id, c.id))
    await db
      .update(blogPost)
      .set({ updatedAt: new Date('2026-04-01T00:00:00Z') })
      .where(eq(blogPost.id, d.id))

    const ids = (await client.blogPosts.list({})).items.map((item) => item.id)
    const order = [d.id, c.id, b.id, a.id].map((id) => ids.indexOf(id))
    expect(order).toEqual([...order].sort((x, y) => x - y))
    const lastDraft = Math.max(
      ...(await client.blogPosts.list({ status: 'draft' })).items.map((i) => ids.indexOf(i.id)),
    )
    const firstPublished = Math.min(
      ...(await client.blogPosts.list({ status: 'published' })).items.map((i) => ids.indexOf(i.id)),
    )
    expect(lastDraft).toBeLessThan(firstPublished)
  })

  it('削除は 204、もう一度は 404', async () => {
    const post = await client.blogPosts.create(blogInput('to-delete'))
    expect((await call(`/blog-posts/${post.id}`, { method: 'DELETE', cookie })).status).toBe(204)
    expect((await call(`/blog-posts/${post.id}`, { method: 'DELETE', cookie })).status).toBe(404)
  })
})

describe('コーディング記録', () => {
  it('kind と referenceUrl を持ち、kind で絞り込める', async () => {
    const created = await client.codingLogs.create({
      status: 'published',
      kind: 'learning_log',
      slug: 'log-a',
      ja: { title: 'ログ', body: '本文' },
      en: { title: null, body: null },
      thumbnailUrl: null,
      publishedAt: null,
      referenceUrl: 'https://tanstack.com/start',
    })
    expect(created).toMatchObject({ kind: 'learning_log', referenceUrl: 'https://tanstack.com/start' })
    expect(created.publishedAt).not.toBeNull()

    const snippet = await client.codingLogs.create({
      status: 'draft',
      slug: 'log-b',
      kind: 'snippet',
      ja: { title: 'コード断片', body: null },
      en: { title: null, body: null },
      thumbnailUrl: null,
      publishedAt: null,
      referenceUrl: null,
    })
    const { items } = await client.codingLogs.list({ kind: 'snippet' })
    expect(items.map((item) => item.id)).toEqual([snippet.id])
    expect(items[0]).toMatchObject({ kind: 'snippet', languages: { ja: false, en: false } })

    const updated = await client.codingLogs.update(
      byId(created.id, {
        status: 'published',

        slug: 'log-a',

        kind: 'memo',

        ja: { title: 'ログ', body: '本文を直した' },

        en: { title: null, body: null },

        thumbnailUrl: null,

        publishedAt: created.publishedAt,

        referenceUrl: null,
      }),
    )
    expect(updated).toMatchObject({ kind: 'memo', referenceUrl: null })
    expect(updated.contentUpdatedAt).not.toBeNull()
  })

  it('referenceUrl は https:// で始まること', async () => {
    const res = await call('/coding-logs', {
      method: 'POST',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status: 'draft',
        kind: 'memo',
        ja: { title: 'x' },
        en: {},
        referenceUrl: 'ftp://example.com',
      }),
    })
    expect(res.status).toBe(422)
    const { data } = (await res.json()) as { data: { fieldErrors: Record<string, string[]> } }
    expect(data.fieldErrors).toEqual({ referenceUrl: ['https:// で始めてください'] })
  })
})

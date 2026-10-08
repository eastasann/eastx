/**
 * 作品・プロジェクト・使用技術（SDD 5.7・5.8）。
 */
import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { isForeignKeyViolation, isUniqueViolation } from '../../src/api/router/base'
import { getDb } from '../../src/db/client'
import { project, stack, work, workStack } from '../../src/db/schema'
import { type AdminClient, byId, call, createClient, createSession } from './helpers'

let client: AdminClient
let cookie: string

beforeAll(async () => {
  ;({ cookie } = await createSession({ admin: true }))
  client = createClient(cookie)
})

const emptyLocalized = { title: null, summary: null, body: null }

describe('作品', () => {
  it('作成・取得・更新・削除。使用技術は stackIds の順で紐づく', async () => {
    const react = await client.stacks.create({ displayName: 'React' })
    const hono = await client.stacks.create({ displayName: 'Hono', showOnTop: false })

    const created = await client.works.create({
      status: 'draft',
      slug: 'crud-app',
      ja: { title: ' CRUD アプリ ', summary: '', body: null },
      en: emptyLocalized,
      linkUrl: 'https://example.com',
      githubUrl: null,
      thumbnailUrl: '/media/uploads/2026/10/x.png',
      stackIds: [hono.id, react.id],
    })
    // 前後の空白を取り除き、空文字は null（SDD 5.0）
    expect(created.ja).toEqual({ title: 'CRUD アプリ', summary: null, body: null })
    expect(created.stacks.map((s) => s.displayName)).toEqual(['Hono', 'React'])
    expect(created.hasDetail).toBe(false)
    expect(created.languages).toEqual({ ja: true, en: false })
    expect(created.firstPublishedAt).toBeNull()

    const fetched = await client.works.get(byId(created.id))
    expect(fetched).toEqual(created)

    const updated = await client.works.update(
      byId(created.id, {
        status: 'draft',

        slug: 'crud-app',

        ja: { title: 'CRUD アプリ', summary: null, body: '## 背景' },

        en: { title: 'CRUD App', summary: null, body: null },

        linkUrl: null,

        githubUrl: 'https://github.com/example/crud',

        thumbnailUrl: null,

        stackIds: [react.id],
      }),
    )
    expect(updated.stacks.map((s) => s.id)).toEqual([react.id])
    expect(updated.hasDetail).toBe(true)
    expect(updated.githubUrl).toBe('https://github.com/example/crud')

    const res = await call(`/works/${created.id}`, { method: 'DELETE', cookie })
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    await expect(client.works.get(byId(created.id))).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect((await call(`/works/${created.id}`, { method: 'DELETE', cookie })).status).toBe(404)
  })

  it('新規作成は先頭に入る（今の最小値 − 1）', async () => {
    const first = await client.works.create(draftWork('order-a'))
    const second = await client.works.create(draftWork('order-b'))
    expect(second.sortOrder).toBe(first.sortOrder - 1)
    const { items } = await client.works.list({})
    expect(items[0]?.id).toBe(second.id)
  })

  it('公開すると first_published_at が入り、非公開に戻しても消えず、もう一度公開しても変わらない', async () => {
    const created = await client.works.create(draftWork('publish-cycle'))
    const published = await client.works.update(
      byId(created.id, { ...draftWork('publish-cycle'), status: 'published' }),
    )
    expect(published.status).toBe('published')
    expect(published.firstPublishedAt).not.toBeNull()

    const unpublished = await client.works.update(byId(created.id, { ...draftWork('publish-cycle'), status: 'draft' }))
    expect(unpublished.firstPublishedAt).toBe(published.firstPublishedAt)

    const republished = await client.works.update(
      byId(created.id, {
        ...draftWork('publish-cycle'),

        status: 'published',
      }),
    )
    expect(republished.firstPublishedAt).toBe(published.firstPublishedAt)
  })

  it('公開にスラッグが足りなければ PUBLISH_REQUIREMENTS_NOT_MET', async () => {
    await expect(client.works.create({ ...draftWork(null), status: 'published' })).rejects.toMatchObject({
      code: 'PUBLISH_REQUIREMENTS_NOT_MET',
      status: 422,
      data: { missing: [{ field: 'slug' }] },
    })
  })

  it('下書きでもタイトルが日英とも空なら INPUT_VALIDATION_FAILED（両方の欄に理由）', async () => {
    const res = await call('/works', {
      method: 'POST',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...draftWork('no-title'), ja: emptyLocalized }),
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as {
      defined: boolean
      code: string
      data: { fieldErrors: Record<string, string[]> }
    }
    expect(body.defined).toBe(true)
    expect(body.code).toBe('INPUT_VALIDATION_FAILED')
    expect(Object.keys(body.data.fieldErrors).sort()).toEqual(['en.title', 'ja.title'])
  })

  it('形式の誤り・上限超えは INPUT_VALIDATION_FAILED（fieldErrors のキーは点区切り）', async () => {
    const res = await call('/works', {
      method: 'POST',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...draftWork('Bad Slug'),
        ja: { title: 'a'.repeat(201), summary: null, body: null },
        linkUrl: 'http://example.com',
        thumbnailUrl: 'https://example.com/x.png',
      }),
    })
    expect(res.status).toBe(422)
    const { data } = (await res.json()) as { data: { fieldErrors: Record<string, string[]> } }
    expect(Object.keys(data.fieldErrors).sort()).toEqual(['ja.title', 'linkUrl', 'slug', 'thumbnailUrl'])
    expect(data.fieldErrors.linkUrl).toEqual(['https:// で始めてください'])
  })

  it('存在しない使用技術・重複した使用技術は INPUT_VALIDATION_FAILED', async () => {
    await expect(
      client.works.create({ ...draftWork('missing-stack'), stackIds: [crypto.randomUUID()] }),
    ).rejects.toMatchObject({ code: 'INPUT_VALIDATION_FAILED', data: { fieldErrors: { stackIds: expect.any(Array) } } })
    const stack = await client.stacks.create({ displayName: 'Dup' })
    await expect(
      client.works.create({ ...draftWork('dup-stack'), stackIds: [stack.id, stack.id] }),
    ).rejects.toMatchObject({ code: 'INPUT_VALIDATION_FAILED' })
  })

  it('スラッグの重複は SLUG_CONFLICT（suggestion に連番）。自分自身のスラッグは重複にしない', async () => {
    const original = await client.works.create(draftWork('taken'))
    await expect(client.works.create(draftWork('taken'))).rejects.toMatchObject({
      code: 'SLUG_CONFLICT',
      status: 409,
      data: { suggestion: 'taken-2' },
    })
    const resaved = await client.works.update(byId(original.id, { ...draftWork('taken') }))
    expect(resaved.slug).toBe('taken')
  })

  it('存在しない ID の更新は NOT_FOUND', async () => {
    await expect(client.works.update(byId(crypto.randomUUID(), { ...draftWork('ghost') }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('一覧は状態で絞り込める', async () => {
    const published = await client.works.create({ ...draftWork('filter-published'), status: 'published' })
    const { items } = await client.works.list({ status: 'published' })
    expect(items.every((item) => item.status === 'published')).toBe(true)
    expect(items.some((item) => item.id === published.id)).toBe(true)
  })

  it('並べ替えは 0 から振り直し、updated_at を変えない。集合が違えば ORDER_OUT_OF_DATE', async () => {
    // 同じミリ秒の中で終わって偶然一致しないよう、最終保存日を過去にずらしておく
    const past = new Date('2026-01-01T00:00:00.000Z')
    await getDb(env).update(work).set({ updatedAt: past })
    const { items } = await client.works.list({})
    const ids = items.map((item) => item.id).reverse()

    expect(await client.works.reorder({ ids })).toEqual({ ids })
    const after = await client.works.list({})
    expect(after.items.map((item) => item.id)).toEqual(ids)
    expect(after.items.map((item) => item.sortOrder)).toEqual(ids.map((_, i) => i))
    expect(after.items.every((item) => item.updatedAt === past.toISOString())).toBe(true)

    await expect(client.works.reorder({ ids: ids.slice(1) })).rejects.toMatchObject({
      code: 'ORDER_OUT_OF_DATE',
      status: 409,
    })
    await expect(client.works.reorder({ ids: [...ids.slice(1), crypto.randomUUID()] })).rejects.toMatchObject({
      code: 'ORDER_OUT_OF_DATE',
    })
  })
})

describe('プロジェクト', () => {
  it('期間を持ち、公開には開始年月とスラッグが要る', async () => {
    const base = {
      status: 'draft' as const,
      slug: null,
      ja: { title: 'プロジェクト', summary: null, body: null },
      en: emptyLocalized,
      linkUrl: null,
      thumbnailUrl: null,
      stackIds: [],
      startDate: null,
      endDate: null,
    }
    const created = await client.projects.create(base)
    expect(created.startDate).toBeNull()

    await expect(client.projects.update(byId(created.id, { ...base, status: 'published' }))).rejects.toMatchObject({
      code: 'PUBLISH_REQUIREMENTS_NOT_MET',
      data: { missing: [{ field: 'slug' }, { field: 'startDate' }] },
    })

    const published = await client.projects.update(
      byId(created.id, {
        ...base,

        status: 'published',

        slug: 'project-a',

        startDate: '2023-04',

        endDate: '2024-03',
      }),
    )
    expect(published).toMatchObject({ status: 'published', startDate: '2023-04', endDate: '2024-03' })
    expect(published.firstPublishedAt).not.toBeNull()

    const { items } = await client.projects.list({})
    expect(items.find((item) => item.id === created.id)).toMatchObject({ startDate: '2023-04', endDate: '2024-03' })
  })

  it('終了年月が開始年月より前、年月の形式の誤りは INPUT_VALIDATION_FAILED', async () => {
    const res = await call('/projects', {
      method: 'POST',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status: 'draft',
        ja: { title: 'p' },
        en: {},
        stackIds: [],
        startDate: '2024-04',
        endDate: '2024-03',
      }),
    })
    expect(res.status).toBe(422)
    const { data } = (await res.json()) as { data: { fieldErrors: Record<string, string[]> } }
    expect(Object.keys(data.fieldErrors)).toEqual(['endDate'])

    await expect(
      client.projects.create({
        status: 'draft',
        slug: null,
        ja: { title: 'p', summary: null, body: null },
        en: emptyLocalized,
        linkUrl: null,
        thumbnailUrl: null,
        stackIds: [],
        startDate: '2024-13',
        endDate: null,
      }),
    ).rejects.toMatchObject({
      code: 'INPUT_VALIDATION_FAILED',
      data: { fieldErrors: { startDate: expect.any(Array) } },
    })
  })
})

describe('使用技術', () => {
  it('識別名を省くと表示名から作り、重複すれば連番、空になるときは stack。末尾に入る', async () => {
    const a = await client.stacks.create({ displayName: 'Next.js' })
    const b = await client.stacks.create({ displayName: 'Next JS' })
    const c = await client.stacks.create({ displayName: '日本語の技術' })
    expect(a.key).toBe('next-js')
    expect(b.key).toBe('next-js-2')
    expect(c.key).toBe('stack')
    expect(a.showOnTop).toBe(true)
    expect(b.sortOrder).toBe(a.sortOrder + 1)
    expect(c.sortOrder).toBe(b.sortOrder + 1)
  })

  it('識別名を指定して重複すれば STACK_KEY_CONFLICT', async () => {
    await client.stacks.create({ key: 'vue', displayName: 'Vue' })
    await expect(client.stacks.create({ key: 'vue', displayName: 'Vue 2' })).rejects.toMatchObject({
      code: 'STACK_KEY_CONFLICT',
      status: 409,
      data: { suggestion: 'vue-2' },
    })
  })

  it('カテゴリと Core は省くと Tools・false。「新しい技術として追加」の本文も今どおり通る', async () => {
    const plain = await client.stacks.create({ displayName: 'Hono', showOnTop: false })
    expect(plain).toMatchObject({ category: 'tools', isCore: false, showOnTop: false })
    const core = await client.stacks.create({ displayName: 'Rust', category: 'languages', isCore: true })
    expect(core).toMatchObject({ category: 'languages', isCore: true, showOnTop: true })
    expect(await client.stacks.get(byId(core.id))).toMatchObject({ category: 'languages', isCore: true })
    expect((await client.stacks.list()).items.find((item) => item.id === core.id)).toMatchObject({
      category: 'languages',
      isCore: true,
    })
  })

  it('Core でトップに表示しない組み合わせと、4つ以外のカテゴリは INPUT_VALIDATION_FAILED', async () => {
    await expect(client.stacks.create({ displayName: 'Zig', isCore: true, showOnTop: false })).rejects.toMatchObject({
      code: 'INPUT_VALIDATION_FAILED',
      data: { fieldErrors: { showOnTop: ['Core の技術はトップに表示します'] } },
    })
    const stack = await client.stacks.create({ displayName: 'Elixir' })
    const body = {
      key: 'elixir',
      displayName: 'Elixir',
      iconUrl: null,
      linkUrl: null,
      category: 'languages' as const,
      isCore: true,
      showOnTop: false,
    }
    await expect(client.stacks.update(byId(stack.id, body))).rejects.toMatchObject({
      code: 'INPUT_VALIDATION_FAILED',
      data: { fieldErrors: { showOnTop: ['Core の技術はトップに表示します'] } },
    })
    const res = await call(`/stacks/${stack.id}`, {
      method: 'PUT',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, isCore: false, category: 'databases' }),
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ data: { fieldErrors: { category: expect.any(Array) } } })
  })

  it('更新でカテゴリ・Core を省くと INPUT_VALIDATION_FAILED（古い管理画面のタブの PUT）', async () => {
    const stack = await client.stacks.create({ displayName: 'Deno', category: 'infrastructure' })
    const res = await call(`/stacks/${stack.id}`, {
      method: 'PUT',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'deno', displayName: 'Deno', iconUrl: null, linkUrl: null, showOnTop: true }),
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({
      code: 'INPUT_VALIDATION_FAILED',
      data: { fieldErrors: { category: expect.any(Array), isCore: expect.any(Array) } },
    })
    expect(await client.stacks.get(byId(stack.id))).toMatchObject({ category: 'infrastructure', isCore: false })
  })

  it('更新は key・displayName・category・isCore・showOnTop が必須。usageCount は作品とプロジェクトの合計', async () => {
    const stack = await client.stacks.create({ displayName: 'Svelte' })
    await client.works.create({ ...draftWork('uses-svelte'), stackIds: [stack.id] })
    await client.projects.create({
      status: 'draft',
      slug: null,
      ja: { title: 'p', summary: null, body: null },
      en: emptyLocalized,
      linkUrl: null,
      thumbnailUrl: null,
      stackIds: [stack.id],
      startDate: null,
      endDate: null,
    })
    const updated = await client.stacks.update(
      byId(stack.id, {
        key: 'sveltekit',
        displayName: 'SvelteKit',
        iconUrl: '/media/uploads/2026/10/s.svg',
        linkUrl: 'https://svelte.dev',
        category: 'frameworks',
        isCore: false,
        showOnTop: false,
      }),
    )
    expect(updated).toMatchObject({
      key: 'sveltekit',
      displayName: 'SvelteKit',
      category: 'frameworks',
      isCore: false,
      showOnTop: false,
      usageCount: 2,
    })

    const res = await call(`/stacks/${stack.id}`, {
      method: 'PUT',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'x' }),
    })
    expect(res.status).toBe(422)

    // 削除すると紐づけも外れる
    expect((await call(`/stacks/${stack.id}`, { method: 'DELETE', cookie })).status).toBe(204)
    const usesSvelte = (await client.works.list({})).items.find((item) => item.slug === 'uses-svelte')
    expect((await client.works.get(byId(usesSvelte?.id ?? ''))).stacks).toEqual([])
  })

  it('並べ替えは updated_at を変えない', async () => {
    const past = new Date('2026-01-01T00:00:00.000Z')
    await getDb(env).update(stack).set({ updatedAt: past })
    const { items } = await client.stacks.list()
    const ids = items.map((item) => item.id).reverse()
    await client.stacks.reorder({ ids })
    const after = await client.stacks.get(byId(items[0]?.id ?? ''))
    expect(after.sortOrder).toBe(ids.length - 1)
    expect(after.updatedAt).toBe(past.toISOString())
  })
})

function draftWork(slug: string | null) {
  return {
    status: 'draft' as const,
    slug,
    ja: { title: `作品 ${slug ?? ''}`, summary: null, body: null },
    en: emptyLocalized,
    linkUrl: null,
    githubUrl: null,
    thumbnailUrl: null,
    stackIds: [],
  }
}

describe('並べ替え（プロジェクト）', () => {
  it('0 から振り直し、updated_at を変えない。集合が違えば ORDER_OUT_OF_DATE', async () => {
    const past = new Date('2026-01-01T00:00:00.000Z')
    await getDb(env).update(project).set({ updatedAt: past })
    const { items } = await client.projects.list({})
    expect(items.length).toBeGreaterThan(1)
    const ids = items.map((item) => item.id).reverse()
    await client.projects.reorder({ ids })
    const after = await client.projects.list({})
    expect(after.items.map((item) => item.id)).toEqual(ids)
    expect(after.items.map((item) => item.sortOrder)).toEqual(ids.map((_, i) => i))
    expect(after.items.every((item) => item.updatedAt === past.toISOString())).toBe(true)
    await expect(client.projects.reorder({ ids: ids.slice(1) })).rejects.toMatchObject({ code: 'ORDER_OUT_OF_DATE' })
  })
})

describe('一意インデックスの違反の判定（確かめてから書くまでの競合の最後の守り）', () => {
  async function insertError(run: () => Promise<unknown>): Promise<unknown> {
    try {
      await run()
    } catch (e) {
      return e
    }
    throw new Error('一意インデックスの違反が起きなかった')
  }

  it('Drizzle・D1 の例外の原因をたどって、テーブルとカラムを見分ける', async () => {
    const db = getDb(env)
    await db.insert(work).values({ slug: 'unique-race', titleJa: 'a', sortOrder: 0 })
    const slugError = await insertError(() =>
      db.insert(work).values({ slug: 'unique-race', titleJa: 'b', sortOrder: 1 }),
    )
    expect(isUniqueViolation(slugError, 'work.slug')).toBe(true)
    expect(isUniqueViolation(slugError, 'project.slug')).toBe(false)

    await db.insert(stack).values({ key: 'unique-race', displayName: 'a', sortOrder: 0 })
    const keyError = await insertError(() =>
      db.batch([db.insert(stack).values({ key: 'unique-race', displayName: 'b', sortOrder: 1 })]),
    )
    expect(isUniqueViolation(keyError, 'stack.key')).toBe(true)
    expect(isUniqueViolation(new Error('other'), 'stack.key')).toBe(false)
  })

  it('外部キーの違反（紐づけ先が消えた）も原因をたどって見分ける', async () => {
    const db = getDb(env)
    const fkError = await insertError(() =>
      db.batch([
        db.insert(workStack).values({ workId: crypto.randomUUID(), stackId: crypto.randomUUID(), sortOrder: 0 }),
      ]),
    )
    expect(isForeignKeyViolation(fkError)).toBe(true)
    expect(isForeignKeyViolation(new Error('other'))).toBe(false)
  })
})

describe('/{id} の手続きの入力（detailed）', () => {
  it('本文やクエリの id ではなく、パスの {id} の行を読み書きする', async () => {
    const a = await client.works.create(draftWork('path-a'))
    const b = await client.works.create(draftWork('path-b'))
    const json = { 'content-type': 'application/json' }

    const got = await call(`/works/${a.id}?id=${b.id}`, { cookie })
    expect(((await got.json()) as { id: string }).id).toBe(a.id)

    const put = await call(`/works/${a.id}`, {
      method: 'PUT',
      cookie,
      headers: json,
      body: JSON.stringify({ ...draftWork('path-a'), id: b.id, ja: { title: '書き換えた' } }),
    })
    expect(put.status).toBe(200)
    expect((await client.works.get(byId(a.id))).ja.title).toBe('書き換えた')
    expect((await client.works.get(byId(b.id))).ja.title).toBe('作品 path-b')

    const del = await call(`/works/${a.id}`, {
      method: 'DELETE',
      cookie,
      headers: json,
      body: JSON.stringify({ id: b.id }),
    })
    expect(del.status).toBe(204)
    expect((await client.works.get(byId(b.id))).id).toBe(b.id)
  })

  it('入力の誤りの fieldErrors のキーは、body・params を落とした欄の名前', async () => {
    const stack = await client.stacks.create({ displayName: 'Detailed Keys' })
    const res = await call(`/stacks/${stack.id}`, {
      method: 'PUT',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'x', linkUrl: 'http://example.com' }),
    })
    expect(res.status).toBe(422)
    const { data } = (await res.json()) as { data: { fieldErrors: Record<string, string[]> } }
    expect(Object.keys(data.fieldErrors).sort()).toEqual(['category', 'isCore', 'key', 'linkUrl', 'showOnTop'])
  })
})

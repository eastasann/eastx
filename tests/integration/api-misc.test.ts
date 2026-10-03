/**
 * ダッシュボード・プロフィール・経歴・スラッグ・アップロード（SDD 5.4〜5.6・5.10）。
 */
import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { app } from '../../src/api/app'
import { type AdminClient, BASE_URL, byId, call, createClient, createSession } from './helpers'

let client: AdminClient
let cookie: string

beforeAll(async () => {
  ;({ cookie } = await createSession({ admin: true }))
  client = createClient(cookie)
})

describe('プロフィール', () => {
  it('まだないときは NOT_FOUND。PUT で作り、SNS リンクは配列の順で置き換える', async () => {
    await expect(client.profile.get()).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })

    const created = await client.profile.update({
      ja: { name: '東 太郎', headline: 'フロントエンドエンジニア', bio: '## こんにちは' },
      en: { name: null, headline: null, bio: null },
      avatarUrl: '/media/uploads/2026/10/a.webp',
      socialLinks: [
        { service: 'github', url: 'https://github.com/example', label: null },
        { service: 'other', url: 'https://example.com', label: 'Portfolio v1' },
      ],
    })
    expect(created.languages).toEqual({ ja: true, en: false })
    expect(created.socialLinks.map((link) => link.service)).toEqual(['github', 'other'])

    const updated = await client.profile.update({
      ja: { name: '東 太郎', headline: null, bio: null },
      en: { name: 'Taro Higashi', headline: null, bio: null },
      avatarUrl: null,
      socialLinks: [{ service: 'x', url: 'https://x.com/example', label: null }],
    })
    expect(updated.id).toBe(created.id)
    expect(updated.socialLinks).toEqual([{ service: 'x', url: 'https://x.com/example', label: null }])
    expect(await client.profile.get()).toEqual(updated)
  })

  it('名前が日英とも空、other で表示名が空、URL の形式は INPUT_VALIDATION_FAILED', async () => {
    const res = await call('/profile', {
      method: 'PUT',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ja: { name: ' ' },
        en: {},
        socialLinks: [
          { service: 'other', url: 'https://example.com' },
          { service: 'github', url: 'http://github.com/example' },
        ],
      }),
    })
    expect(res.status).toBe(422)
    const { data } = (await res.json()) as { data: { fieldErrors: Record<string, string[]> } }
    expect(Object.keys(data.fieldErrors).sort()).toEqual([
      'en.name',
      'ja.name',
      'socialLinks.0.label',
      'socialLinks.1.url',
    ])
  })
})

describe('経歴', () => {
  const careerInput = {
    status: 'draft' as const,
    kind: 'work' as const,
    startDate: null,
    endDate: null,
    ja: { title: 'エンジニア', organization: '株式会社○○', location: '東京', body: null },
    en: { title: null, organization: null, location: null, body: null },
  }

  it('作成（201）・取得・更新・削除。公開には開始年月が要る', async () => {
    const res = await call('/careers', {
      method: 'POST',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'draft', kind: 'education', ja: { title: '学生' }, en: {} }),
    })
    expect(res.status).toBe(201)
    const created = (await res.json()) as { id: string; kind: string }
    expect(created.kind).toBe('education')

    await expect(
      client.careers.update(byId(created.id, { ...careerInput, status: 'published' })),
    ).rejects.toMatchObject({
      code: 'PUBLISH_REQUIREMENTS_NOT_MET',
      data: { missing: [{ field: 'startDate' }] },
    })
    const published = await client.careers.update(
      byId(created.id, {
        ...careerInput,
        status: 'published',
        startDate: '2024-04',
      }),
    )
    expect(published).toMatchObject({ status: 'published', startDate: '2024-04', languages: { ja: true, en: false } })
    expect(await client.careers.get(byId(created.id))).toEqual(published)

    expect((await call(`/careers/${created.id}`, { method: 'DELETE', cookie })).status).toBe(204)
    await expect(client.careers.get(byId(created.id))).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('kind は省けない（省いた PUT で種類が書き換わらないように）', async () => {
    const created = await client.careers.create({ ...careerInput, kind: 'education' })
    const res = await call(`/careers/${created.id}`, {
      method: 'PUT',
      cookie,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'draft', ja: { title: '学生' }, en: {} }),
    })
    expect(res.status).toBe(422)
    const { data } = (await res.json()) as { data: { fieldErrors: Record<string, string[]> } }
    expect(Object.keys(data.fieldErrors)).toEqual(['kind'])
    expect((await client.careers.get(byId(created.id))).kind).toBe('education')
  })

  it('一覧は開始年月が空の下書きを先頭に、続けて開始年月の新しい順。状態と種類で絞り込める', async () => {
    const old = await client.careers.create({ ...careerInput, startDate: '2020-04' })
    const recent = await client.careers.create({ ...careerInput, startDate: '2024-04' })
    const undated = await client.careers.create(careerInput)
    const school = await client.careers.create({ ...careerInput, kind: 'education', startDate: '2016-04' })

    const ids = (await client.careers.list({})).items.map((item) => item.id)
    const order = [undated.id, recent.id, old.id, school.id].map((id) => ids.indexOf(id))
    expect(order).toEqual([...order].sort((a, b) => a - b))

    const education = await client.careers.list({ kind: 'education' })
    expect(education.items.every((item) => item.kind === 'education')).toBe(true)
    expect(education.items.find((item) => item.id === school.id)).toMatchObject({
      ja: { title: 'エンジニア', organization: '株式会社○○' },
    })
  })
})

describe('ダッシュボード', () => {
  it('種類ごとの件数と、最終保存日の新しい順の下書き（最大10件）と総数', async () => {
    const before = await client.dashboard.get()
    const base = {
      status: 'draft' as const,
      slug: null,
      ja: { title: '下書き', body: null },
      en: { title: null, body: null },
      thumbnailUrl: null,
      publishedAt: null,
    }
    const created = []
    for (let i = 0; i < 11; i++) {
      created.push(await client.blogPosts.create({ ...base, ja: { title: `下書き ${i}`, body: null } }))
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    await client.stacks.create({ displayName: 'Dashboard Stack' })

    const after = await client.dashboard.get()
    expect(after.counts.blogPosts.draft).toBe(before.counts.blogPosts.draft + 11)
    expect(after.counts.stacks.total).toBe(before.counts.stacks.total + 1)
    expect(after.drafts.total).toBe(before.drafts.total + 11)
    expect(after.drafts.items).toHaveLength(10)
    expect(after.drafts.items[0]).toMatchObject({
      type: 'blog-post',
      id: created[10]?.id,
      title: { ja: '下書き 10', en: null },
    })
    const times = after.drafts.items.map((item) => item.updatedAt)
    expect(times).toEqual([...times].sort().reverse())
  })
})

describe('スラッグ', () => {
  it('suggest: 英語のタイトルから作り、同じ種類の中で重複すれば連番。空になるときは null', async () => {
    expect(await client.slugs.suggest({ type: 'work', title: 'My App' })).toEqual({ slug: 'my-app' })
    const mine = await client.works.create({
      status: 'draft',
      slug: 'my-app',
      ja: { title: 'マイアプリ', summary: null, body: null },
      en: { title: 'My App', summary: null, body: null },
      linkUrl: null,
      githubUrl: null,
      thumbnailUrl: null,
      stackIds: [],
    })
    expect(await client.slugs.suggest({ type: 'work', title: 'My App' })).toEqual({ slug: 'my-app-2' })
    // 編集中の項目自身とは重複しない
    expect(await client.slugs.suggest({ type: 'work', title: 'My App', excludeId: mine.id })).toEqual({
      slug: 'my-app',
    })
    // 種類が違えば重複しない
    expect(await client.slugs.suggest({ type: 'blog-post', title: 'My App' })).toEqual({ slug: 'my-app' })
    expect(await client.slugs.suggest({ type: 'work', title: '日本語だけ' })).toEqual({ slug: null })
  })

  it('availability: 使えるか。形式の誤りは INPUT_VALIDATION_FAILED', async () => {
    await client.projects.create({
      status: 'draft',
      slug: 'taken-project',
      ja: { title: 'p', summary: null, body: null },
      en: { title: null, summary: null, body: null },
      linkUrl: null,
      thumbnailUrl: null,
      stackIds: [],
      startDate: null,
      endDate: null,
    })
    expect(await client.slugs.availability({ type: 'project', slug: 'taken-project' })).toEqual({ available: false })
    expect(await client.slugs.availability({ type: 'project', slug: 'free-project' })).toEqual({ available: true })
    const res = await call('/slugs/availability?type=project&slug=Bad%20Slug', { cookie })
    expect(res.status).toBe(422)
    const { data } = (await res.json()) as { data: { fieldErrors: Record<string, string[]> } }
    expect(Object.keys(data.fieldErrors)).toEqual(['slug'])
  })
})

describe('アップロード', () => {
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
  const upload = (file: File) => {
    const form = new FormData()
    form.set('file', file)
    return call('/uploads', { method: 'POST', cookie, body: form })
  }

  it('R2 に置き、/media/uploads/{yyyy}/{mm}/{uuid}.{拡張子} を返す。配信できる', async () => {
    const res = await upload(new File([PNG], 'a.png', { type: 'image/png' }))
    expect(res.status).toBe(201)
    const body = (await res.json()) as { url: string; contentType: string; size: number }
    expect(body.url).toMatch(/^\/media\/uploads\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/)
    expect(body).toMatchObject({ contentType: 'image/png', size: PNG.byteLength })

    const object = await env.MEDIA.get(body.url.replace(/^\/media\//, ''))
    expect(object?.httpMetadata?.contentType).toBe('image/png')
    const served = await app.fetch(new Request(`${BASE_URL}${body.url}`))
    expect(served.status).toBe(200)
    expect(served.headers.get('Content-Type')).toBe('image/png')
  })

  it('SVG は <svg を含むこと。WebP・GIF・JPEG・AVIF も先頭のバイトで確かめる', async () => {
    const svg = await upload(
      new File(['<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'], 'i.svg', { type: 'image/svg+xml' }),
    )
    expect(svg.status).toBe(201)
    const webp = Uint8Array.from(
      [...'RIFF']
        .map((c) => c.charCodeAt(0))
        .concat(
          [0, 0, 0, 0],
          [...'WEBP'].map((c) => c.charCodeAt(0)),
        ),
    )
    expect((await upload(new File([webp], 'i.webp', { type: 'image/webp' }))).status).toBe(201)
    expect((await upload(new File(['GIF89a....'], 'i.gif', { type: 'image/gif' }))).status).toBe(201)
    expect(
      (await upload(new File([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])], 'i.jpg', { type: 'image/jpeg' }))).status,
    ).toBe(201)
    const avif = Uint8Array.from([
      0,
      0,
      0,
      0x1c,
      ...[...'ftypavif'].map((c) => c.charCodeAt(0)),
      0,
      0,
      0,
      0,
      ...[...'avifmif1'].map((c) => c.charCodeAt(0)),
      0,
      0,
      0,
      0,
    ])
    expect((await upload(new File([avif], 'i.avif', { type: 'image/avif' }))).status).toBe(201)
  })

  it('宣言と中身が合わない・画像でない形式は「画像ファイルではありません」', async () => {
    for (const file of [
      new File(['not a png'], 'fake.png', { type: 'image/png' }),
      new File(['<html></html>'], 'x.svg', { type: 'image/svg+xml' }),
      new File(['hello'], 'x.txt', { type: 'text/plain' }),
    ]) {
      const res = await upload(file)
      expect(res.status).toBe(422)
      const { data } = (await res.json()) as { data: { fieldErrors: Record<string, string[]> } }
      expect(data.fieldErrors).toEqual({ file: ['画像ファイルではありません'] })
    }
  })

  it('5MB を超えると「ファイルが大きすぎます（上限 5MB）」', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1)
    big.set(PNG)
    const res = await upload(new File([big], 'big.png', { type: 'image/png' }))
    expect(res.status).toBe(422)
    const { data } = (await res.json()) as { data: { fieldErrors: Record<string, string[]> } }
    expect(data.fieldErrors).toEqual({ file: ['ファイルが大きすぎます（上限 5MB）'] })
  })

  it('本文が上限を大きく超えるリクエストは、読み込みを途中で止める（認証より前に本文を読むため、未認証でも）', async () => {
    const form = new FormData()
    form.set('file', new File([new Uint8Array(6 * 1024 * 1024)], 'huge.png', { type: 'image/png' }))
    const res = await call('/uploads', { method: 'POST', body: form })
    expect(res.status).toBe(422)
    const { data } = (await res.json()) as { data: { fieldErrors: Record<string, string[]> } }
    expect(data.fieldErrors).toEqual({ file: ['ファイルが大きすぎます（上限 5MB）'] })

    const json = await call('/works', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ja: { body: 'x'.repeat(6 * 1024 * 1024) } }),
    })
    expect(json.status).toBe(422)
    expect(((await json.json()) as { data: { formErrors: string[] } }).data.formErrors).toEqual([
      'リクエストの本文が大きすぎます',
    ])
  })

  it('file がなければ INPUT_VALIDATION_FAILED', async () => {
    const res = await call('/uploads', { method: 'POST', cookie, body: new FormData() })
    expect(res.status).toBe(422)
  })
})

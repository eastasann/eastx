/**
 * プライバシーのページ（SDD 5.12）。認証・認可・CSRF の一律の確認は api-auth.test.ts にもある
 */
import { env } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '../../src/db/client'
import { privacyPage } from '../../src/db/schema'
import { type AdminClient, call, createClient, createSession } from './helpers'

let client: AdminClient
let cookie: string

beforeAll(async () => {
  ;({ cookie } = await createSession({ admin: true }))
  client = createClient(cookie)
})

beforeEach(async () => {
  await getDb(env).delete(privacyPage)
})

const put = (body: unknown, sessionCookie = cookie) =>
  call('/privacy', {
    method: 'PUT',
    cookie: sessionCookie,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('プライバシーのページ', () => {
  it('行が無いときは NOT_FOUND', async () => {
    await expect(client.privacy.get()).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect((await call('/privacy', { cookie })).status).toBe(404)
  })

  it('PUT で行が無ければ作り、2回目は同じ行を更新して updatedAt が進む', async () => {
    const created = await client.privacy.update({ ja: { body: '## 集めるもの' }, en: { body: null } })
    expect(created).toMatchObject({
      ja: { body: '## 集めるもの' },
      en: { body: null },
      languages: { ja: true, en: false },
    })
    expect(await client.privacy.get()).toEqual(created)

    // 同じミリ秒の中で2回保存すると updatedAt が変わらないので、間を空ける
    await new Promise((resolve) => setTimeout(resolve, 5))
    const updated = await client.privacy.update({ ja: { body: '## 集めるもの' }, en: { body: '## What' } })
    expect(updated.id).toBe(created.id)
    expect(updated.languages).toEqual({ ja: true, en: true })
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt))
    expect(await getDb(env).select().from(privacyPage)).toHaveLength(1)
  })

  it('日英とも空で保存できる（行は残り、言語ありは両方 false）', async () => {
    await client.privacy.update({ ja: { body: '本文' }, en: { body: 'Body' } })
    const emptied = await client.privacy.update({ ja: { body: null }, en: { body: null } })
    expect(emptied).toMatchObject({ ja: { body: null }, en: { body: null }, languages: { ja: false, en: false } })
    expect(await client.privacy.get()).toEqual(emptied)
  })

  it('本文は前後の空白を除き、空白と改行だけの本文とキーの省略は null', async () => {
    const res = await put({ ja: { body: '\n  ## 見出し\n\n本文  \n' }, en: { body: ' \n\t\n ' } })
    expect(res.status).toBe(200)
    const saved = (await res.json()) as { ja: { body: string | null }; en: { body: string | null } }
    expect(saved.ja.body).toBe('## 見出し\n\n本文')
    expect(saved.en.body).toBeNull()

    expect((await put({ ja: {}, en: {} })).status).toBe(200)
    expect(await client.privacy.get()).toMatchObject({ ja: { body: null }, en: { body: null } })
  })

  it('100,000字を超える本文は INPUT_VALIDATION_FAILED（ちょうどは通る）', async () => {
    expect((await put({ ja: { body: 'あ'.repeat(100_000) }, en: { body: null } })).status).toBe(200)

    const tooLong = await put({ ja: { body: null }, en: { body: 'a'.repeat(100_001) } })
    expect(tooLong.status).toBe(422)
    const { code, data } = (await tooLong.json()) as { code: string; data: { fieldErrors: Record<string, string[]> } }
    expect(code).toBe('INPUT_VALIDATION_FAILED')
    expect(Object.keys(data.fieldErrors)).toEqual(['en.body'])
  })

  it('未認証は 401、管理者でないセッションは 403（行を書き換えない）', async () => {
    await client.privacy.update({ ja: { body: '本文' }, en: { body: null } })
    const before = await client.privacy.get()

    expect((await call('/privacy')).status).toBe(401)
    expect((await put({ ja: { body: '書き換え' }, en: { body: null } }, '')).status).toBe(401)

    const nonAdmin = await createSession({ admin: false })
    expect((await call('/privacy', { cookie: nonAdmin.cookie })).status).toBe(403)
    expect((await put({ ja: { body: '書き換え' }, en: { body: null } }, nonAdmin.cookie)).status).toBe(403)

    expect(await client.privacy.get()).toEqual(before)
  })
})

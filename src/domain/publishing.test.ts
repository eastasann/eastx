import { describe, expect, it } from 'vitest'
import {
  firstPublishedAtAfterSave,
  hasAnyTitle,
  missingForPublish,
  type PostDatesInput,
  postDatesAfterSave,
  transitionOf,
} from './publishing'

describe('transitionOf（SDD 5.3 の表）', () => {
  it.each([
    [null, 'draft', 'saveDraft'],
    ['draft', 'draft', 'saveDraft'],
    [null, 'published', 'publish'],
    ['draft', 'published', 'publish'],
    ['published', 'published', 'update'],
    ['published', 'draft', 'unpublish'],
  ] as const)('%s → %s は %s', (current, next, expected) => {
    expect(transitionOf(current, next)).toBe(expected)
  })
})

describe('hasAnyTitle', () => {
  it('タイトルが日英のどちらかにあれば通す', () => {
    expect(hasAnyTitle({ title: 'a' }, { title: null })).toBe(true)
    expect(hasAnyTitle({ title: null }, { title: 'b' })).toBe(true)
    expect(hasAnyTitle({ title: null }, { title: '' })).toBe(false)
  })
})

describe('missingForPublish', () => {
  it('作品: 言語ありとスラッグがあれば空', () => {
    expect(missingForPublish('work', { ja: { title: 'a' }, en: { title: null }, slug: 'a' })).toEqual([])
  })

  it('作品: スラッグがなければ slug', () => {
    expect(missingForPublish('work', { ja: { title: 'a' }, en: {}, slug: null })).toEqual([{ field: 'slug' }])
  })

  it('経歴: スラッグは要らず、開始年月が要る', () => {
    expect(missingForPublish('career', { ja: { title: 'a' }, en: {}, startDate: null })).toEqual([
      { field: 'startDate' },
    ])
  })

  it('プロジェクト: スラッグと開始年月の両方が要る', () => {
    expect(missingForPublish('project', { ja: { title: 'a' }, en: {} })).toEqual([
      { field: 'slug' },
      { field: 'startDate' },
    ])
  })

  it('ブログ: どちらも言語ありでなければ、書きかけの言語の足りない項目を挙げる', () => {
    expect(
      missingForPublish('blogPost', {
        ja: { title: 'タイトル', body: null },
        en: { title: null, body: null },
        slug: 'a',
      }),
    ).toEqual([{ field: 'body', lang: 'ja' }])
    expect(
      missingForPublish('codingLog', {
        ja: { title: 'タイトル', body: null },
        en: { title: null, body: 'b' },
        slug: 'a',
      }),
    ).toEqual([
      { field: 'body', lang: 'ja' },
      { field: 'title', lang: 'en' },
    ])
  })

  it('ブログ: どちらも書きかけでなければ、両方の言語の項目を挙げる', () => {
    expect(missingForPublish('blogPost', { ja: {}, en: {}, slug: 'a' })).toEqual([
      { field: 'title', lang: 'ja' },
      { field: 'body', lang: 'ja' },
      { field: 'title', lang: 'en' },
      { field: 'body', lang: 'en' },
    ])
  })

  it('ブログ: 片方の言語で言語ありなら、もう片方は問わない', () => {
    expect(
      missingForPublish('blogPost', { ja: { title: 'a', body: 'b' }, en: { title: 'c', body: null }, slug: 'a' }),
    ).toEqual([])
  })
})

describe('firstPublishedAtAfterSave', () => {
  const now = new Date('2026-10-01T00:00:00Z')
  const before = new Date('2026-01-01T00:00:00Z')

  it('初めて公開したときに今の日時を入れる', () => {
    expect(firstPublishedAtAfterSave(null, 'published', now)).toEqual(now)
  })

  it('下書きのままなら空', () => {
    expect(firstPublishedAtAfterSave(null, 'draft', now)).toBeNull()
  })

  it('一度入れたら変えない（非公開に戻しても、もう一度公開しても）', () => {
    expect(firstPublishedAtAfterSave(before, 'draft', now)).toEqual(before)
    expect(firstPublishedAtAfterSave(before, 'published', now)).toEqual(before)
  })
})

describe('postDatesAfterSave', () => {
  const now = new Date('2026-10-01T00:00:00Z')
  const published = new Date('2026-09-01T00:00:00Z')
  const updated = new Date('2026-09-15T00:00:00Z')
  const content = { ja: { title: 'T', body: 'B' }, en: { title: null, body: null } }

  const run = (input: Partial<PostDatesInput> & Pick<PostDatesInput, 'next'>) =>
    postDatesAfterSave({ current: null, now, ...input })

  it('公開日が空のまま初めて公開すると今の日時', () => {
    expect(run({ next: { status: 'published', publishedAt: null, ...content } })).toEqual({
      ok: true,
      publishedAt: now,
      contentUpdatedAt: null,
    })
  })

  it('下書き保存では公開日も更新日も空', () => {
    expect(run({ next: { status: 'draft', publishedAt: null, ...content } })).toEqual({
      ok: true,
      publishedAt: null,
      contentUpdatedAt: null,
    })
  })

  it('一度も公開していないものは公開日を受け付けない', () => {
    const result = run({ next: { status: 'published', publishedAt: published, ...content } })
    expect(result.ok).toBe(false)
  })

  it('公開日は今より後にできない', () => {
    const result = run({
      current: { status: 'published', publishedAt: published, contentUpdatedAt: null, ...content },
      next: { status: 'published', publishedAt: new Date(now.getTime() + 1), ...content },
    })
    expect(result).toEqual({ ok: false, message: '今より後の日時にはできません' })
  })

  it('一度公開したものは公開日を空にできない', () => {
    const result = run({
      current: { status: 'draft', publishedAt: published, contentUpdatedAt: null, ...content },
      next: { status: 'draft', publishedAt: null, ...content },
    })
    expect(result.ok).toBe(false)
  })

  it('公開後は公開日を直せる', () => {
    const edited = new Date('2026-08-01T00:00:00Z')
    expect(
      run({
        current: { status: 'published', publishedAt: published, contentUpdatedAt: null, ...content },
        next: { status: 'published', publishedAt: edited, ...content },
      }),
    ).toEqual({ ok: true, publishedAt: edited, contentUpdatedAt: null })
  })

  it('更新する: タイトルか本文が変われば更新日を今にする', () => {
    expect(
      run({
        current: { status: 'published', publishedAt: published, contentUpdatedAt: updated, ...content },
        next: { status: 'published', publishedAt: published, ja: { title: 'T', body: 'B2' }, en: content.en },
      }),
    ).toEqual({ ok: true, publishedAt: published, contentUpdatedAt: now })
  })

  it('更新する: タイトルと本文が同じなら更新日を変えない', () => {
    expect(
      run({
        current: { status: 'published', publishedAt: published, contentUpdatedAt: updated, ...content },
        next: { status: 'published', publishedAt: published, ...content },
      }),
    ).toEqual({ ok: true, publishedAt: published, contentUpdatedAt: updated })
  })

  it('非公開のあいだの変更と、もう一度の公開では、公開日も更新日も変えない', () => {
    const current = { status: 'draft' as const, publishedAt: published, contentUpdatedAt: updated, ...content }
    const changed = { ja: { title: 'T2', body: 'B' }, en: content.en }
    expect(run({ current, next: { status: 'draft', publishedAt: published, ...changed } })).toEqual({
      ok: true,
      publishedAt: published,
      contentUpdatedAt: updated,
    })
    expect(run({ current, next: { status: 'published', publishedAt: published, ...changed } })).toEqual({
      ok: true,
      publishedAt: published,
      contentUpdatedAt: updated,
    })
  })

  it('非公開に戻しても公開日を残す', () => {
    expect(
      run({
        current: { status: 'published', publishedAt: published, contentUpdatedAt: null, ...content },
        next: { status: 'draft', publishedAt: published, ...content },
      }),
    ).toEqual({ ok: true, publishedAt: published, contentUpdatedAt: null })
  })
})

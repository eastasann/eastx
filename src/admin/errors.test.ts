import { ORPCError } from '@orpc/client'
import { describe, expect, it } from 'vitest'
import { fieldKey, isAuthError, issuesToErrors, missingKey, saveFailureOf } from './errors'

describe('欄の名前と fieldErrors のキー（ADR-008）', () => {
  it('配列の添字を点区切りにする', () => {
    expect(fieldKey('socialLinks[0].url')).toBe('socialLinks.0.url')
    expect(fieldKey('ja.title')).toBe('ja.title')
  })

  it('公開に足りない項目は、言語ごとの項目に言語を前に付ける', () => {
    expect(missingKey({ field: 'title', lang: 'en' })).toBe('en.title')
    expect(missingKey({ field: 'slug' })).toBe('slug')
  })

  it('Standard Schema の issues をサーバーと同じ形に分ける', () => {
    expect(
      issuesToErrors([
        { message: 'a', path: ['ja', 'title'] },
        { message: 'b', path: ['ja', 'title'] },
        { message: 'c', path: ['socialLinks', 0, { key: 'url' }] },
        { message: 'd', path: [] },
        { message: 'e' },
      ]),
    ).toEqual({ fieldErrors: { 'ja.title': ['a', 'b'], 'socialLinks.0.url': ['c'] }, formErrors: ['d', 'e'] })
  })
})

const defined = (code: string, status: number, data?: unknown) =>
  new ORPCError(code, { defined: true, status, message: `${code} の文言`, data })

describe('保存の失敗の出し方（SDD 8章）', () => {
  it('INPUT_VALIDATION_FAILED は欄ごとの理由', () => {
    const data = { fieldErrors: { 'ja.title': ['x'] }, formErrors: ['y'] }
    expect(saveFailureOf(defined('INPUT_VALIDATION_FAILED', 422, data))).toEqual({ kind: 'invalid', ...data })
  })

  it('PUBLISH_REQUIREMENTS_NOT_MET は足りない項目の一覧', () => {
    const missing = [{ field: 'slug' }, { field: 'title', lang: 'en' }]
    expect(saveFailureOf(defined('PUBLISH_REQUIREMENTS_NOT_MET', 422, { missing }))).toEqual({
      kind: 'missing',
      missing,
    })
  })

  it('重複は欄と候補', () => {
    expect(saveFailureOf(defined('SLUG_CONFLICT', 409, { suggestion: 'my-app-2' }))).toEqual({
      kind: 'conflict',
      field: 'slug',
      message: 'SLUG_CONFLICT の文言',
      suggestion: 'my-app-2',
    })
    expect(saveFailureOf(defined('STACK_KEY_CONFLICT', 409, { suggestion: 'react-2' }))).toMatchObject({
      kind: 'conflict',
      field: 'key',
    })
  })

  it('認可のエラーは API クライアントが画面を移すので auth、それ以外は failed', () => {
    expect(saveFailureOf(new ORPCError('UNAUTHORIZED', { status: 401 }))).toEqual({ kind: 'auth' })
    expect(isAuthError(new ORPCError('FORBIDDEN', { status: 403 }))).toBe(true)
    expect(saveFailureOf(defined('NOT_FOUND', 404))).toEqual({ kind: 'failed' })
    expect(saveFailureOf(new ORPCError('INTERNAL_SERVER_ERROR', { status: 500 }))).toEqual({ kind: 'failed' })
    expect(saveFailureOf(new TypeError('Failed to fetch'))).toEqual({ kind: 'failed' })
    // 定義されていない（サーバーの手続きの外から来た）エラーは、data を信用しない
    expect(saveFailureOf(new ORPCError('INPUT_VALIDATION_FAILED', { status: 422 }))).toEqual({ kind: 'failed' })
  })
})

import { describe, expect, it } from 'vitest'
import { FIELD_ORDER, parseStackForm, type StackForm, showOnTopLocked, toForm, withCore } from './stack-form'

const form: StackForm = {
  key: 'react',
  displayName: 'React',
  iconUrl: '',
  linkUrl: 'https://react.dev',
  category: 'frameworks',
  isCore: false,
  showOnTop: true,
}
const loaded: StackForm = { ...form, category: 'languages', isCore: true }

describe('A7 の Core の規則（design-spec 6.7.2）', () => {
  it('Core をオンにすると「トップに表示する」もオンになり、押せなくなる', () => {
    const next = withCore({ ...form, showOnTop: false }, true)
    expect(next).toEqual({ ...form, isCore: true, showOnTop: true })
    expect(showOnTopLocked(next)).toBe(true)
  })

  it('Core をオフに戻すと「トップに表示する」は押せるようになり、値はオンのまま', () => {
    const next = withCore({ ...form, isCore: true, showOnTop: true }, false)
    expect(next).toEqual({ ...form, isCore: false, showOnTop: true })
    expect(showOnTopLocked(next)).toBe(false)
  })

  it('Core がオンでトップに表示しない値を読み込んだときは、値を変えず、「トップに表示する」を押せるまま残す', () => {
    const stack = {
      ...form,
      id: 's1',
      iconUrl: null,
      isCore: true,
      showOnTop: false,
      sortOrder: 0,
      usageCount: 0,
      createdAt: '2026-10-08T00:00:00.000Z',
      updatedAt: '2026-10-08T00:00:00.000Z',
    }
    const values = toForm(stack)
    expect(values).toMatchObject({ isCore: true, showOnTop: false })
    expect(showOnTopLocked(values)).toBe(false)
  })

  it('新規作成の初期値はカテゴリ Tools・Core オフ・トップに表示する', () => {
    expect(toForm(null)).toMatchObject({ category: 'tools', isCore: false, showOnTop: true })
  })
})

describe('A7 の誤りの欄の順（design-spec 6.7.2）', () => {
  it('表示名・識別名・アイコン・リンク・カテゴリ・Core・トップに表示する', () => {
    expect(FIELD_ORDER).toEqual(['displayName', 'key', 'iconUrl', 'linkUrl', 'category', 'isCore', 'showOnTop'])
  })
})

describe('A7 の退避の読み直し（design-spec 6.4）', () => {
  it('今の形の退避はそのまま読む', () => {
    expect(parseStackForm(form, loaded)).toEqual(form)
  })

  it('カテゴリと Core のキーが無い退避は、その2つを読み込んだ値で埋める', () => {
    const { category: _category, isCore: _isCore, ...before } = form
    expect(parseStackForm({ ...before, showOnTop: false }, loaded)).toEqual({
      ...form,
      showOnTop: false,
      category: 'languages',
      isCore: true,
    })
  })

  it('新規作成では初期値（Tools・オフ）で埋める', () => {
    const { category: _category, isCore: _isCore, ...before } = form
    expect(parseStackForm(before, toForm(null))).toMatchObject({ category: 'tools', isCore: false })
  })

  it('ほかの欄が欠けた・形の違う退避は読まない', () => {
    const { displayName: _displayName, ...noName } = form
    expect(parseStackForm(noName, loaded)).toBeNull()
    expect(parseStackForm({ ...form, category: 'other' }, loaded)).toBeNull()
    const { isCore: _isCore, ...onlyCategory } = form
    expect(parseStackForm(onlyCategory, loaded)).toBeNull()
  })
})

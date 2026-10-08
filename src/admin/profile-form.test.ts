import { describe, expect, it } from 'vitest'
import { firstErrorField } from './editor-rules'
import { FIELD_ORDER, parseProfileForm } from './profile-form'

const localized = { name: '東', headline: 'エンジニア', tagline: '一言', bio: '' }
const form = { ja: localized, en: localized, avatarUrl: '', socialLinks: [] }

describe('A3 の退避の読み直し（design-spec 6.4）', () => {
  it('今の形の退避はそのまま読む', () => {
    expect(parseProfileForm(form)).toEqual(form)
  })

  it('一言のキーが無い退避（一言を足す前に退避した値）は、一言を空にして読む', () => {
    const { tagline: _tagline, ...before } = localized
    expect(parseProfileForm({ ...form, ja: before, en: before })).toEqual({
      ...form,
      ja: { ...localized, tagline: '' },
      en: { ...localized, tagline: '' },
    })
  })

  it('ほかの欄が欠けた・形の違う退避は読まない', () => {
    const { name: _name, ...noName } = localized
    expect(parseProfileForm({ ...form, ja: noName })).toBeNull()
    expect(parseProfileForm({ ...form, ja: { ...localized, tagline: 1 } })).toBeNull()
  })
})

describe('A3 の誤りの欄の順（design-spec 6.7.2）', () => {
  it('名前・肩書き・一言・自己紹介（日本語 → 英語）・写真・SNS リンク', () => {
    expect(FIELD_ORDER).toEqual([
      'ja.name',
      'ja.headline',
      'ja.tagline',
      'ja.bio',
      'en.name',
      'en.headline',
      'en.tagline',
      'en.bio',
      'avatarUrl',
      'socialLinks',
    ])
    expect(firstErrorField(FIELD_ORDER, ['en.name', 'ja.bio', 'ja.tagline'])).toBe('ja.tagline')
  })
})

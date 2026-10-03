import { describe, expect, it } from 'vitest'
import { uploadProblem } from './fields'
import { displayTitle, languagesLabel } from './labels'
import { pickEnum } from './search'

describe('一覧の表示（design-spec 6.6）', () => {
  it('言語の列', () => {
    expect(languagesLabel({ ja: true, en: true })).toBe('日英')
    expect(languagesLabel({ ja: true, en: false })).toBe('日のみ')
    expect(languagesLabel({ ja: false, en: true })).toBe('英のみ')
    expect(languagesLabel({ ja: false, en: false })).toBe('—')
  })

  it('タイトルは日本語、なければ英語', () => {
    expect(displayTitle({ ja: 'マイアプリ', en: 'My App' })).toBe('マイアプリ')
    expect(displayTitle({ ja: null, en: 'My App' })).toBe('My App')
  })

  it('絞り込みのクエリは決まった値だけを通す', () => {
    expect(pickEnum('draft', ['draft', 'published'])).toBe('draft')
    expect(pickEnum('deleted', ['draft', 'published'])).toBeUndefined()
    expect(pickEnum(1, ['draft', 'published'])).toBeUndefined()
  })
})

describe('アップロードの前の確かめ（design-spec 6.7.3）', () => {
  it('画像の形式と 5MB の上限', () => {
    expect(uploadProblem({ type: 'image/png', size: 1024 })).toBeNull()
    expect(uploadProblem({ type: 'application/pdf', size: 1024 })).toBe('画像ファイルではありません')
    expect(uploadProblem({ type: 'image/webp', size: 5 * 1024 * 1024 + 1 })).toBe('ファイルが大きすぎます（上限 5MB）')
  })
})

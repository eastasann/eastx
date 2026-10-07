import { describe, expect, it } from 'vitest'
import { EDITOR_VIEWS, effectiveEditorView, FORM_VIEWS, readView } from './view-preference'

const store = (value: string | null) => ({ getItem: () => value })

describe('表示の切り替えの記憶（design-spec 6.7.1）', () => {
  it('覚えた値を読む', () => {
    expect(readView(store('bilingual'), 'k', EDITOR_VIEWS, 'split')).toBe('bilingual')
    expect(readView(store('bilingual'), 'k', FORM_VIEWS, 'single')).toBe('bilingual')
  })

  it('読めない値は既定', () => {
    expect(readView(store(null), 'k', EDITOR_VIEWS, 'split')).toBe('split')
    expect(readView(store('wide'), 'k', EDITOR_VIEWS, 'split')).toBe('split')
    expect(readView(store('split'), 'k', FORM_VIEWS, 'single')).toBe('single')
    expect(readView(null, 'k', FORM_VIEWS, 'single')).toBe('single')
    const throwing = {
      getItem: () => {
        throw new Error('使えない')
      },
    }
    expect(readView(throwing, 'k', EDITOR_VIEWS, 'split')).toBe('split')
  })

  it('モバイルの split は write として描く。ほかの表示とデスクトップはそのまま', () => {
    expect(effectiveEditorView('split', true)).toBe('write')
    expect(effectiveEditorView('split', false)).toBe('split')
    expect(effectiveEditorView('bilingual', true)).toBe('bilingual')
    expect(effectiveEditorView('preview', true)).toBe('preview')
  })
})

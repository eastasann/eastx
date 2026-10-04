import { describe, expect, it } from 'vitest'
import { en } from './en'
import { getMessages } from './index'
import { ja } from './ja'

/** 辞書の形（キーの入れ子と、値が関数か文字列か）だけを取り出す */
function shapeOf(value: unknown): unknown {
  if (typeof value === 'function') return 'function'
  if (typeof value === 'string') return 'string'
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, shapeOf(child)]),
    )
  }
  return typeof value
}

describe('getMessages', () => {
  it('言語ごとの辞書を返す', () => {
    expect(getMessages('ja')).toBe(ja)
    expect(getMessages('en')).toBe(en)
  })

  it('日英の辞書は同じキーを持ち、差し込みのある文言はどちらも関数', () => {
    expect(shapeOf(en)).toEqual(shapeOf(ja))
  })

  it('文字列の値は空でない', () => {
    const empty: string[] = []
    const walk = (value: unknown, path: string) => {
      if (typeof value === 'string' && value.trim() === '') empty.push(path)
      if (value !== null && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`)
      }
    }
    walk(ja, 'ja')
    walk(en, 'en')
    expect(empty).toEqual([])
  })
})

describe('差し込みのある文言', () => {
  it('言語ラベルと注記は、引数の言語（実際に出している中身の言語）の名前を入れる', () => {
    expect(ja.label.onlyIn('en')).toBe('英語のみ')
    expect(en.label.onlyIn('ja')).toBe('Japanese only')
    expect(ja.notice.postOnlyIn('ja')).toBe('この記事は日本語のみです')
    expect(en.notice.postOnlyIn('en')).toBe('This post is available in English only.')
    expect(ja.notice.codingLogOnlyIn('en')).toBe('この記録は英語のみです')
    expect(en.notice.codingLogOnlyIn('ja')).toBe('This log is available in Japanese only.')
    expect(ja.notice.workBodyOnlyIn('ja')).toBe('この作品の説明は日本語のみです')
    expect(en.notice.workBodyOnlyIn('ja')).toBe('The description of this work is available in Japanese only.')
    expect(ja.notice.projectBodyOnlyIn('en')).toBe('このプロジェクトの説明は英語のみです')
    expect(en.notice.projectBodyOnlyIn('en')).toContain('English only')
  })

  it('ページングと件数の文言', () => {
    expect(ja.paging.controls('作品')).toBe('作品のページ')
    expect(en.paging.controls('Works')).toBe('Works pages')
    expect(ja.paging.position(2, 5)).toBe('2 / 5')
    expect(en.paging.position(2, 5)).toBe('2 / 5')
    expect(ja.paging.announce(2, 5)).toBe('5ページ中2ページ目')
    expect(en.paging.announce(2, 5)).toBe('Page 2 of 5')
    expect(ja.label.moreStacks(3)).toBe('ほかに3個')
    expect(en.label.moreStacks(3)).toBe('3 more')
  })

  it('テーマの切り替えの読み上げ名は、今の設定と押したあとの設定を入れる', () => {
    expect(ja.theme.toggle(ja.theme.light, ja.theme.dark)).toBe('テーマ: ライト（押すとダーク）')
    expect(en.theme.toggle(en.theme.light, en.theme.dark)).toBe(`Theme: ${en.theme.light} (switch to ${en.theme.dark})`)
  })
})

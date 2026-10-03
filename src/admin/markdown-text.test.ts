import { describe, expect, it } from 'vitest'
import { differingRange, uploadMarker, withoutUploadMarkers } from './markdown-text'

describe('withoutUploadMarkers', () => {
  it('アップロード中の仮の記法だけを除く', () => {
    const marker = uploadMarker()
    expect(withoutUploadMarkers(`前\n${marker}\n![図](/media/a.png)`)).toBe('前\n\n![図](/media/a.png)')
  })

  it('仮の記法は1つずつ違う', () => {
    expect(uploadMarker()).not.toBe(uploadMarker())
  })
})

describe('differingRange', () => {
  const apply = (before: string, range: { from: number; to: number; insert: string }) =>
    before.slice(0, range.from) + range.insert + before.slice(range.to)

  it('前後の同じ部分を残して、違う部分だけを置き換える', () => {
    expect(differingRange('abc\n', 'abc')).toEqual({ from: 3, to: 4, insert: '' })
    expect(differingRange('hello world', 'hello there world')).toEqual({ from: 6, to: 6, insert: 'there ' })
  })

  it('どの組み合わせでも置き換えた結果が後の値になる', () => {
    const pairs: [string, string][] = [
      ['', 'abc'],
      ['abc', ''],
      ['aaa', 'aa'],
      ['abab', 'ab'],
      ['x', 'y'],
      ['same', 'same'],
    ]
    for (const [before, after] of pairs) expect(apply(before, differingRange(before, after))).toBe(after)
  })
})

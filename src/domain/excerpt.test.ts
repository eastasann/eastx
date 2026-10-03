import { describe, expect, it } from 'vitest'
import { dropUnclosedFence, EXCERPT_LENGTH, excerptOf, plainTextOf } from './excerpt'

describe('plainTextOf', () => {
  it('見出しの記号・強調・リンクの記法を取り除き、文字は残す', () => {
    expect(plainTextOf('## 見出し\n\n**太字**と[リンク](https://example.com)と`code`')).toBe(
      '見出し 太字とリンクとcode',
    )
  })

  it('コードブロック・画像・生の HTML を取り除く', () => {
    const markdown = [
      '前',
      '',
      '```ts',
      'const a = 1',
      '```',
      '',
      '![画像](/media/a.png)',
      '',
      '<div>html</div>',
      '',
      '後',
    ]
    expect(plainTextOf(markdown.join('\n'))).toBe('前 後')
  })

  it('リスト・表・引用は項目の間を空白で区切る', () => {
    expect(plainTextOf('- 一\n- 二\n\n> 引用\n\n| a | b |\n|---|---|\n| c | d |')).toBe('一 二 引用 a b c d')
  })

  it('記法だけの本文は空', () => {
    expect(plainTextOf('```\nonly code\n```\n\n![x](/media/x.png)')).toBe('')
  })
})

describe('dropUnclosedFence', () => {
  it('閉じていないコードブロックを開始の行から後ろごと捨てる', () => {
    expect(dropUnclosedFence('本文\n\n```ts\nconst a')).toBe('本文\n')
  })

  it('閉じたコードブロックはそのまま', () => {
    const markdown = '本文\n```ts\nconst a\n```\n続き'
    expect(dropUnclosedFence(markdown)).toBe(markdown)
  })

  it('開いたフェンスより短いフェンスでは閉じない', () => {
    expect(dropUnclosedFence('前\n````\n```\nまだコード')).toBe('前')
  })

  it('チルダのフェンスも同じ', () => {
    expect(dropUnclosedFence('前\n~~~\n```\n')).toBe('前')
  })

  it('info にバッククォートを含む行はフェンスではない', () => {
    const markdown = '前\n``` a`b\n後'
    expect(dropUnclosedFence(markdown)).toBe(markdown)
  })
})

describe('excerptOf', () => {
  it('目安より短ければそのまま', () => {
    expect(excerptOf('短い本文です。', 'ja')).toBe('短い本文です。')
  })

  it('日本語は約80字で切って「…」を付ける', () => {
    const excerpt = excerptOf('あ'.repeat(100), 'ja')
    expect(excerpt).toBe(`${'あ'.repeat(EXCERPT_LENGTH.ja)}…`)
  })

  it('英語は約160字の範囲の最後の空白で切る', () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')
    const excerpt = excerptOf(words, 'en')
    expect(excerpt?.endsWith('…')).toBe(true)
    const body = excerpt?.slice(0, -1) ?? ''
    expect(body.length).toBeLessThanOrEqual(EXCERPT_LENGTH.en)
    expect(words.startsWith(body)).toBe(true)
    expect(words[body.length]).toBe(' ')
  })

  it('絵文字などのサロゲートペアを途中で切らない', () => {
    const excerpt = excerptOf('😀'.repeat(100), 'ja')
    expect(Array.from(excerpt ?? '')).toHaveLength(EXCERPT_LENGTH.ja + 1)
  })

  it('記法を取り除いて空なら null', () => {
    expect(excerptOf('```\ncode\n```', 'ja')).toBeNull()
  })

  it('先頭だけを読んで切れたコードブロックは抜粋に入れない', () => {
    expect(excerptOf('説明\n\n```ts\nconst secret = 1', 'ja')).toBe('説明')
  })

  it('リスト・引用の中で切れたコードブロックも、閉じていないコードブロックとして抜粋に入れない', () => {
    expect(excerptOf('- 手順\n\n  ```sh\n  secret', 'ja')).toBe('手順')
    expect(excerptOf('> 引用\n>\n> ```sh\n> secret', 'ja')).toBe('引用')
  })
})

import { describe, expect, it } from 'vitest'
import { type MarkdownStack, RENDER_VERSION, renderMarkdown } from './render'

const SITE = 'https://x.eastasian.dev'
const JA = { lang: 'ja' } as const

describe('renderMarkdown', () => {
  describe('生の HTML', () => {
    it('ブロックの HTML は出さない', async () => {
      const html = await renderMarkdown('<script>alert(1)</script>\n\n<div onclick="x()">hi</div>\n\ntext', JA)
      expect(html).not.toContain('<script')
      expect(html).not.toContain('<div onclick')
      expect(html).not.toContain('onclick')
      expect(html).toContain('<p>text</p>')
    })

    it('インラインの HTML も出さない', async () => {
      const html = await renderMarkdown('a <img src=x onerror="alert(1)"> b <b>bold</b>', JA)
      expect(html).not.toContain('<img')
      expect(html).not.toContain('onerror')
      expect(html).not.toContain('<b>')
    })
  })

  describe('URL', () => {
    it('javascript: のリンクは href を落とす', async () => {
      const html = await renderMarkdown('[click](javascript:alert(1))', JA)
      expect(html).not.toContain('javascript:')
      expect(html).toContain('click')
    })

    it('javascript: の画像は src を落とす', async () => {
      const html = await renderMarkdown('![x](javascript:alert(1))', JA)
      expect(html).not.toContain('javascript:')
    })

    it('data: のリンクも落とす', async () => {
      const html = await renderMarkdown('[x](data:text/html;base64,PHNjcmlwdD4=)', JA)
      expect(html).not.toContain('data:')
    })
  })

  describe('見出しのレベル', () => {
    it('# はページタイトルの1つ下（h2）から始まる', async () => {
      const html = await renderMarkdown('# A\n\n## B\n\n### C\n\n#### D\n\n##### E\n\n###### F', JA)
      expect(html).toContain('<h2>A</h2>')
      expect(html).toContain('<h3>B</h3>')
      expect(html).toContain('<h4>C</h4>')
      expect(html).toContain('<h5>D</h5>')
      expect(html).toContain('<h6>E</h6>')
      expect(html).toContain('<h6>F</h6>')
      expect(html).not.toContain('<h1')
    })
  })

  describe('リンク', () => {
    it('外部リンクは別タブで開き、↗ を付ける', async () => {
      const html = await renderMarkdown('[docs](https://example.com/a)', { lang: 'ja', siteOrigin: SITE })
      expect(html).toContain('<a href="https://example.com/a" target="_blank" rel="noopener noreferrer">docs ↗</a>')
    })

    it('サイト内のリンク（相対・同じ origin）は同じタブのまま', async () => {
      const html = await renderMarkdown(`[a](/ja/works/x) [b](${SITE}/en) [c](#top)`, { lang: 'ja', siteOrigin: SITE })
      expect(html).toContain('<a href="/ja/works/x">a</a>')
      expect(html).toContain(`<a href="${SITE}/en">b</a>`)
      expect(html).not.toContain('target=')
    })

    it('プロトコル相対の URL は外部', async () => {
      const html = await renderMarkdown('[a](//evil.example/x)', { lang: 'ja', siteOrigin: SITE })
      expect(html).toContain('target="_blank"')
    })

    it('mailto: は別タブにしない', async () => {
      const html = await renderMarkdown('[mail](mailto:me@example.com)', { lang: 'ja', siteOrigin: SITE })
      expect(html).toContain('<a href="mailto:me@example.com">mail</a>')
    })

    it('siteOrigin がなければ http・https の絶対 URL はすべて外部', async () => {
      const html = await renderMarkdown(`[b](${SITE}/en)`, JA)
      expect(html).toContain('target="_blank"')
    })
  })

  describe('コードブロック', () => {
    it('言語ごとに色分けし、コピーのボタンを付ける場所で包む', async () => {
      const html = await renderMarkdown('```ts\nconst a: number = 1\n```', JA)
      expect(html).toMatch(
        /^<div data-code-block=""><pre class="shiki shiki-themes github-light-high-contrast github-dark-default"/,
      )
      expect(html).toContain('--shiki-light:')
      expect(html).toContain('--shiki-dark:')
      expect(html).toContain('const')
    })

    it('コードの中の HTML は文字として出す', async () => {
      const html = await renderMarkdown('```html\n<script>alert(1)</script>\n```', JA)
      expect(html).not.toContain('<script>')
      expect(html).toContain('&#x3C;')
    })

    it('読み込んでいない言語・言語なしも同じ枠で出す', async () => {
      for (const source of ['```cobol\nDISPLAY "HI".\n```', '```\nplain\n```']) {
        const html = await renderMarkdown(source, JA)
        expect(html).toMatch(/^<div data-code-block=""><pre class="shiki/)
      }
    })

    it('別名（js・sh）も色分けする', async () => {
      for (const source of ['```sh\necho hi\n```', '```js\nlet a\n```']) {
        const html = await renderMarkdown(source, JA)
        // 色分けされると、トークンごとに色の付いた span に分かれる（色分けなしは行で1つの span）
        expect(html.match(/<span style="--shiki-light:/g)?.length).toBeGreaterThan(1)
      }
    })

    it('インラインのコードは包まない', async () => {
      const html = await renderMarkdown('use `x` here', JA)
      expect(html).toBe('<p>use <code>x</code> here</p>')
    })
  })

  describe('脚注', () => {
    it('参照と脚注の id・リンクが対応し、見出しと戻るリンクは本文の言語', async () => {
      const ja = await renderMarkdown('本文[^1]\n\n[^1]: 注', JA)
      expect(ja).toContain('href="#user-content-fn-1"')
      expect(ja).toContain('id="user-content-fn-1"')
      expect(ja).toContain('href="#user-content-fnref-1"')
      expect(ja).toContain('id="user-content-fnref-1"')
      expect(ja).toContain('>脚注</h3>')
      expect(ja).toContain('aria-label="参照 1 へ戻る"')
      const en = await renderMarkdown('text[^1]\n\n[^1]: note', { lang: 'en' })
      expect(en).toContain('>Footnotes</h3>')
      expect(en).toContain('aria-label="Back to reference 1"')
    })
  })

  describe('GFM', () => {
    it('表・チェックリスト・取り消し線', async () => {
      const html = await renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n~~old~~', JA)
      expect(html).toContain('<table>')
      expect(html).toContain('type="checkbox"')
      expect(html).toContain('<del>old</del>')
    })
  })

  describe('太字と使用技術の照合', () => {
    const REACT: MarkdownStack = { key: 'react', displayName: 'React', iconUrl: '/media/uploads/2026/09/react.svg' }
    const GO: MarkdownStack = { key: 'go', displayName: 'Go', iconUrl: null }
    const icon = (stack: MarkdownStack, initial: string) =>
      `<img src="${stack.iconUrl}" alt="" width="1" height="1" data-stack-icon="" data-initial="${initial}">`
    const render = (markdown: string, stacks?: MarkdownStack[]) => renderMarkdown(markdown, { ...JA, stacks })

    it('表示名と一致した太字の前にアイコンを入れる。src は /media/ 始まりの iconUrl', async () => {
      const html = await render('主に **React** で', [REACT])
      expect(html).toBe(`<p>主に ${icon(REACT, 'R')}<strong>React</strong> で</p>`)
      expect(html).toMatch(/<img src="\/media\//)
    })

    it('識別名とも一致し、大文字小文字と前後の空白は区別しない', async () => {
      expect(await render('**REACT**', [REACT])).toContain(`${icon(REACT, 'R')}<strong>REACT</strong>`)
      const spaced: MarkdownStack = { key: ' bun ', displayName: ' Bun ', iconUrl: null }
      expect(await render('**bun**', [spaced])).toContain('aria-hidden="true">B</span><strong>bun</strong>')
    })

    it('一致しない太字と、子が複数のノードの太字はそのまま', async () => {
      expect(await render('**使いやすさ**', [REACT])).toBe('<p><strong>使いやすさ</strong></p>')
      expect(await render('**React** と **[React](/ja)** と ***React* app**', [REACT])).toBe(
        `<p>${icon(REACT, 'R')}<strong>React</strong> と <strong><a href="/ja">React</a></strong> と <strong><em>React</em> app</strong></p>`,
      )
    })

    it('複数の使用技術に一致したら識別名の昇順で最初のものを使う', async () => {
      const a: MarkdownStack = { key: 'a-react', displayName: 'Other', iconUrl: '/media/a.svg' }
      const b: MarkdownStack = { key: 'b-react', displayName: 'React', iconUrl: '/media/b.svg' }
      const c: MarkdownStack = { key: 'react', displayName: 'Third', iconUrl: '/media/c.svg' }
      // 'react' は c の識別名と b の表示名に一致する。識別名の昇順で b が先
      const html = await render('**React**', [c, b, a])
      expect(html).toContain('src="/media/b.svg"')
    })

    it('iconUrl がなければ頭文字の丸（読み上げから外す）', async () => {
      expect(await render('**go**', [GO])).toBe(
        '<p><span data-stack-initial="" aria-hidden="true">G</span><strong>go</strong></p>',
      )
    })

    it('stacks を渡さないと何もしない', async () => {
      expect(await render('**React**')).toBe('<p><strong>React</strong></p>')
      expect(await render('**React**', [])).toBe('<p><strong>React</strong></p>')
    })

    it('見出しの中の太字にも入れ、見出しのレベルと外部リンクの処理はそのまま', async () => {
      const html = await render('# **React**\n\n[**React**](https://react.dev)', [REACT])
      expect(html).toContain(`<h2>${icon(REACT, 'R')}<strong>React</strong></h2>`)
      expect(html).toContain(
        `<a href="https://react.dev" target="_blank" rel="noopener noreferrer">${icon(REACT, 'R')}<strong>React</strong> ↗</a>`,
      )
    })
  })

  describe('元の行番号（sourceLines）', () => {
    const md = '# 見出し\n\n段落\n\n- a\n- b\n\n```ts\nconst x = 1\n```\n'

    it('渡さなければ付けない（公開側の描画は変わらない）', async () => {
      expect(await renderMarkdown(md, JA)).not.toContain('data-source-line')
    })

    it('最上位のブロックに元の行番号を付ける。コードブロックは包みの要素に付ける', async () => {
      const html = await renderMarkdown(md, { ...JA, sourceLines: true })
      expect(html).toContain('<h2 data-source-line="1">')
      expect(html).toContain('<p data-source-line="3">')
      expect(html).toContain('<ul data-source-line="5">')
      expect(html).toContain('<div data-code-block="" data-source-line="8">')
      // 入れ子のブロックには付けない
      expect(html).not.toContain('<li data-source-line')
    })

    it('サニタイズの後に付ける。本文に書いた属性は通らず、値は構文木の行番号だけ', async () => {
      const html = await renderMarkdown('<p data-source-line="99">x</p>\n\ny', { ...JA, sourceLines: true })
      expect(html).not.toContain('99')
      expect(html).toContain('<p data-source-line="3">y</p>')
    })
  })

  it('描画の版は 3', () => {
    expect(RENDER_VERSION).toBe(3)
  })
})

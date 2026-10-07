/**
 * コードブロックの色分け（ADR-012）。Shiki は JavaScript の正規表現エンジンと、使う言語だけを読み込む。
 * ライト・ダークの2つのテーマの色を CSS 変数（--shiki-light・--shiki-dark）で出し、
 * どちらを使うかは <html data-theme> に合わせてスタイルの側で決める（src/ui/markdown-body.tsx）。
 */
import type { Element, ElementContent, Root } from 'hast'
import { toString as hastToString } from 'hast-util-to-string'
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { visit } from 'unist-util-visit'

// 言語を足すとバンドルと描画の CPU 時間が増える（ADR-012 のトレードオフ）。
// 読み込みは関数で渡し、作るのに失敗したときのやり直しで読み込みからやり直せるようにする
const LANGS = [
  () => import('shiki/langs/typescript.mjs'),
  () => import('shiki/langs/tsx.mjs'),
  () => import('shiki/langs/javascript.mjs'),
  () => import('shiki/langs/jsx.mjs'),
  () => import('shiki/langs/json.mjs'),
  () => import('shiki/langs/shellscript.mjs'),
  () => import('shiki/langs/html.mjs'),
  () => import('shiki/langs/css.mjs'),
  () => import('shiki/langs/python.mjs'),
  () => import('shiki/langs/go.mjs'),
  () => import('shiki/langs/rust.mjs'),
  () => import('shiki/langs/sql.mjs'),
  () => import('shiki/langs/yaml.mjs'),
  () => import('shiki/langs/markdown.mjs'),
  () => import('shiki/langs/diff.mjs'),
]

// トークンの色がすべて、コードブロックの地の色（bg.subtle）に対して 4.5:1 以上になるテーマ（ADR-012）。
// github-light の赤（キーワード）と github-dark の灰色（コメント）は届かない
const THEMES = { light: 'github-light-high-contrast', dark: 'github-dark-default' } as const

let highlighter: Promise<HighlighterCore> | undefined

/** 同じ isolate の中では1回だけ作る。作るのに失敗したら、次の呼び出しでやり直す */
export function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [
      () => import('shiki/themes/github-light-high-contrast.mjs'),
      () => import('shiki/themes/github-dark-default.mjs'),
    ],
    langs: LANGS,
    engine: createJavaScriptRegexEngine(),
  }).catch((error: unknown) => {
    highlighter = undefined
    throw error
  })
  return highlighter
}

function languageOf(code: Element): string | undefined {
  const classes = code.properties.className
  if (!Array.isArray(classes)) return undefined
  for (const name of classes) {
    if (typeof name === 'string' && name.startsWith('language-')) return name.slice('language-'.length).toLowerCase()
  }
  return undefined
}

/**
 * `pre > code` を Shiki の出力に置き換え、`<div data-code-block>` で包む。
 * 包みの要素は、本文を出す部品がコピーのボタンを付ける場所になる。
 * 読み込んでいない言語は、色分けせずに同じ見た目の枠で出す
 */
export function rehypeHighlight(shiki: HighlighterCore) {
  const loaded = new Set(shiki.getLoadedLanguages())
  return (tree: Root) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'pre' || parent === undefined || index === undefined) return
      const code = node.children.find((child): child is Element => child.type === 'element' && child.tagName === 'code')
      if (!code) return
      const requested = languageOf(code)
      const lang = requested !== undefined && loaded.has(requested) ? requested : 'text'
      const highlighted = shiki.codeToHast(hastToString(code).replace(/\n$/, ''), {
        lang,
        themes: THEMES,
        defaultColor: false,
      })
      const pre = highlighted.children.find((child): child is Element => child.type === 'element')
      if (!pre) return
      const wrapper: ElementContent = {
        type: 'element',
        tagName: 'div',
        properties: { dataCodeBlock: '' },
        children: [pre],
        // 元の行の位置を引き継ぐ。管理画面のプレビューの行番号の属性（render.ts の sourceLines）が読む
        position: node.position,
      }
      parent.children[index] = wrapper
      return 'skip'
    })
  }
}

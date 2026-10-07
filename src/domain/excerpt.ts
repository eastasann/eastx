/**
 * 抜粋の作り方（design-spec 6.1.4、SDD ADR-019）。本文の Markdown から記法・見出しの記号・画像・コードブロックを
 * 取り除いたテキストの先頭を使う。ページの説明（ADR-019）が使う。
 */
import type { Nodes, Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import type { Lang } from '../i18n/detect'

/** 抜粋の長さの目安（文字数。design-spec 6.1.4） */
export const EXCERPT_LENGTH: Record<Lang, number> = { ja: 80, en: 160 }

const ELLIPSIS = '…'

/** 文字としては出さないノード。コードブロック・画像・生の HTML・リンクの定義・脚注の定義 */
const SKIPPED = new Set(['code', 'image', 'imageReference', 'html', 'definition', 'footnoteDefinition'])

/** 子がブロックで、子どうしを空白で区切るノード。段落・見出し・表のセルの子はインラインなので、区切らずにつなぐ */
const BLOCK_CONTAINERS = new Set(['root', 'blockquote', 'list', 'listItem', 'table', 'tableRow'])

function textOf(node: Nodes): string {
  if (SKIPPED.has(node.type)) return ''
  if (node.type === 'text' || node.type === 'inlineCode') return node.value
  if (node.type === 'break') return ' '
  if (!('children' in node)) return ''
  const parts = (node.children as Nodes[]).map(textOf)
  return BLOCK_CONTAINERS.has(node.type) ? parts.join(' ') : parts.join('')
}

/** Markdown から記法を取り除いたテキスト。空白は1つにまとめる */
export function plainTextOf(markdown: string): string {
  const tree: Root = unified().use(remarkParse).use(remarkGfm).parse(markdown)
  return textOf(tree).replace(/\s+/g, ' ').trim()
}

/**
 * 抜粋。目安の長さを超えるときは切って「…」を付ける。英語は語の途中で切らないよう、目安の範囲の最後の空白で切る。
 * 記法を取り除いた結果が空なら null（抜粋の行を出さない）
 */
export function excerptOf(markdown: string, lang: Lang): string | null {
  const text = plainTextOf(markdown)
  if (text === '') return null
  const chars = Array.from(text)
  const limit = EXCERPT_LENGTH[lang]
  if (chars.length <= limit) return text
  let head = chars.slice(0, limit).join('')
  if (lang === 'en') {
    const space = head.lastIndexOf(' ')
    if (space > 0) head = head.slice(0, space)
  }
  return `${head.trimEnd()}${ELLIPSIS}`
}

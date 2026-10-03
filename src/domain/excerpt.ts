/**
 * 抜粋の作り方（design-spec 6.1.4、SDD 5.11）。本文の Markdown から記法・見出しの記号・画像・コードブロックを
 * 取り除いたテキストの先頭を使う。公開側のトップのカード・行と、ページの説明（ADR-019）が使う。
 */
import type { Nodes, Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import type { Lang } from '../i18n/detect'

/** 抜粋の長さの目安（文字数。design-spec 6.1.4） */
export const EXCERPT_LENGTH: Record<Lang, number> = { ja: 80, en: 160 }

/** 抜粋のために DB から読む本文の先頭の文字数（SDD 5.11）。抜粋の長さに対して十分に長くとる */
export const EXCERPT_SOURCE_LENGTH = 2000

const ELLIPSIS = '…'

/** 文字としては出さないノード。コードブロック・画像・生の HTML・リンクの定義・脚注の定義 */
const SKIPPED = new Set(['code', 'image', 'imageReference', 'html', 'definition', 'footnoteDefinition'])

/** 子がブロックで、子どうしを空白で区切るノード。段落・見出し・表のセルの子はインラインなので、区切らずにつなぐ */
const BLOCK_CONTAINERS = new Set(['root', 'blockquote', 'list', 'listItem', 'table', 'tableRow'])

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/

/**
 * 閉じていないコードブロックを、その開始の行から後ろごと捨てる。本文の先頭だけを読んだとき（SDD 5.11）に、
 * 切った位置でコードブロックが閉じていないと、残りの行が本文として抜粋に入るのを防ぐ。
 * 本文の全体でも閉じていないコードブロックは文書の終わりまで続く（CommonMark）ので、結果は変わらない
 */
export function dropUnclosedFence(markdown: string): string {
  const lines = markdown.split('\n')
  let open: { line: number; close: RegExp } | null = null
  for (const [index, line] of lines.entries()) {
    if (open !== null) {
      if (open.close.test(line)) open = null
      continue
    }
    const match = FENCE_OPEN.exec(line)
    const fence = match?.[1]
    if (!match || !fence) continue
    // バッククォートのフェンスの info に、バッククォートは書けない（CommonMark）
    if (fence.startsWith('`') && line.slice(match[0].length).includes('`')) continue
    open = { line: index, close: new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`) }
  }
  return open === null ? markdown : lines.slice(0, open.line).join('\n')
}

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
  const tree: Root = unified().use(remarkParse).use(remarkGfm).parse(dropUnclosedFence(markdown))
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

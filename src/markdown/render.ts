/**
 * Markdown の描画（ADR-012、design-spec 6.3.1）。公開側（サーバー）と管理画面のプレビュー（ブラウザ）が同じ関数を使う。
 * remark-parse → remark-gfm → remark-rehype（生の HTML は通さない）→ rehype-sanitize（GitHub のスキーマ）
 * → 見出しのレベルと外部リンク → Shiki → HTML の文字列。
 * サニタイズを Shiki より前に置くのは、Shiki が付けるスタイルを消さないため。
 */
import type { Element, Root } from 'hast'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import type { Lang } from '../i18n/detect'
import { getHighlighter, rehypeHighlight } from './highlight'

/**
 * 描画の処理（プラグイン・サニタイズのスキーマ・Shiki の設定・出力の形）を変えたら上げる。
 * Cache API のキーに入るので、上げると古い描画結果が使われなくなる（ADR-011）
 */
export const RENDER_VERSION = 2

/** 脚注の見出しと戻るリンクの読み上げ名。本文の言語で出す（描画結果は本文の言語ごとにキャッシュする。ADR-011） */
const FOOTNOTE_LABELS: Record<Lang, { label: string; back: (index: number) => string }> = {
  ja: { label: '脚注', back: (index) => `参照 ${index + 1} へ戻る` },
  en: { label: 'Footnotes', back: (index) => `Back to reference ${index + 1}` },
}

/**
 * GitHub のスキーマ。ただし id の接頭辞（user-content-）は remark-rehype が脚注に付けるので、ここでは付けない。
 * 両方で付けると id だけが二重になり、href と合わずに脚注のリンクが飛ばない。
 * Markdown の記法で id を書く方法はなく、id を持つのは remark-rehype が作る脚注だけ
 */
const SANITIZE_SCHEMA = { ...defaultSchema, clobberPrefix: '' }

export interface RenderOptions {
  /** 本文の言語 */
  lang: Lang
  /**
   * サイトの origin（例: `https://x.eastasian.dev`）。これと同じ origin の絶対 URL は外部リンクとして扱わない。
   * 省略すると、http・https の絶対 URL はすべて外部リンクになる
   */
  siteOrigin?: string
}

const HEADING = /^h([1-6])$/

/** 本文の見出しはページタイトル（h1）の1つ下から始める。h6 より下はないので h6 のまま */
function rehypeShiftHeadings() {
  return (tree: Root) => {
    visit(tree, 'element', (node) => {
      const match = HEADING.exec(node.tagName)
      if (match) node.tagName = `h${Math.min(Number(match[1]) + 1, 6)}`
    })
  }
}

function isExternal(href: string, siteOrigin: string | undefined): boolean {
  // 相対 URL を解決するための基準。外部かどうかの判定にだけ使う
  const base = siteOrigin ?? 'https://site.invalid'
  let url: URL
  try {
    url = new URL(href, base)
  } catch {
    // URL として読めない href は外部サイトへ移れないので、別タブ・↗ を付けない
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return url.origin !== new URL(base).origin
}

/** 外部サイトへのリンクは別タブで開き、↗ を付ける */
function rehypeExternalLinks(siteOrigin: string | undefined) {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'a') return
      const href = node.properties.href
      if (typeof href !== 'string' || !isExternal(href, siteOrigin)) return
      node.properties.target = '_blank'
      node.properties.rel = ['noopener', 'noreferrer']
      node.children.push({ type: 'text', value: ' ↗' })
    })
  }
}

/** Markdown を、そのまま埋め込める（サニタイズ済みの）HTML の文字列にする */
export async function renderMarkdown(markdown: string, options: RenderOptions): Promise<string> {
  const shiki = await getHighlighter()
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, {
      footnoteLabel: FOOTNOTE_LABELS[options.lang].label,
      footnoteBackLabel: FOOTNOTE_LABELS[options.lang].back,
    })
    .use(rehypeSanitize, SANITIZE_SCHEMA)
    .use(rehypeShiftHeadings)
    .use(rehypeExternalLinks, options.siteOrigin)
    .use(rehypeHighlight, shiki)
    .use(rehypeStringify)
    .process(markdown)
  return String(file)
}

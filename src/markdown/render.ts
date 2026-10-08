/**
 * Markdown の描画（ADR-012、design-spec 6.3.1）。公開側（サーバー）と管理画面のプレビュー（ブラウザ）が同じ関数を使う。
 * remark-parse → remark-gfm → remark-rehype（生の HTML は通さない）→ rehype-sanitize（GitHub のスキーマ）
 * → 太字と使用技術の照合（stacks を渡したときだけ）→ 見出しのレベルと外部リンク → Shiki
 * → 元の行番号の属性（sourceLines のときだけ）→ HTML の文字列。
 * サニタイズを Shiki より前に置くのは、Shiki が付けるスタイルを消さないため。
 */
import type { Element, Root } from 'hast'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { SKIP, visit } from 'unist-util-visit'
import { initialOf } from '../domain/initial'
import type { Lang } from '../i18n/detect'
import { getHighlighter, rehypeHighlight } from './highlight'

/**
 * 描画の処理（プラグイン・サニタイズのスキーマ・Shiki の設定・出力の形）を変えたら上げる。
 * Cache API のキーに入るので、上げると古い描画結果が使われなくなる（ADR-011）
 */
export const RENDER_VERSION = 3

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
  /**
   * 太字と照合する使用技術（「トップに表示する」に関わらず全件）。渡したときだけ、一致した太字の前にアイコンを入れる。
   * 渡すのは自己紹介の描画だけ（公開側の P1 と A3 のプレビュー）
   */
  stacks?: MarkdownStack[]
  /**
   * 最上位のブロックに、Markdown の元の行番号（1始まり）を `data-source-line` で付ける。管理画面のプレビューが
   * エディタのスクロールに追従するためだけに使う。公開側は渡さないので、公開側の HTML とキャッシュは変わらない
   */
  sourceLines?: boolean
}

/** 太字との照合に使う使用技術。識別名・表示名・アイコンの3つだけが描画結果に効く（キャッシュのキーの版も同じ3つで作る） */
export interface MarkdownStack {
  key: string
  displayName: string
  /** `/media/` 始まり（DB の CHECK 制約 stack_icon_url） */
  iconUrl: string | null
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

/** 識別名の昇順。照合で複数に一致したときの優先と、キャッシュのキーの版の並びに使う */
export function byStackKey(a: MarkdownStack, b: MarkdownStack): number {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

/**
 * 子が1つのテキストだけの太字が、使用技術の表示名か識別名と（大文字小文字を区別せず）完全に一致したら、前にアイコンを入れる。
 * 表示名は日英共通（SDD 6.3）なので、本文の言語は見ない。アイコンは隣の太字に表示名があるので装飾として扱い、
 * 読み込めないときの頭文字の丸は MarkdownBody が data-initial から作る。サニタイズの後に入れるので、
 * サニタイズのスキーマは広げない（src は DB の iconUrl だけ）
 */
function rehypeStackIcons(stacks: MarkdownStack[] | undefined) {
  return (tree: Root) => {
    if (stacks === undefined || stacks.length === 0) return
    const byName = new Map<string, MarkdownStack>()
    for (const stack of [...stacks].sort(byStackKey)) {
      for (const name of [stack.displayName, stack.key]) {
        const normalized = name.trim().toLowerCase()
        if (!byName.has(normalized)) byName.set(normalized, stack)
      }
    }
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'strong' || parent === undefined || index === undefined) return
      const [only, ...rest] = node.children
      if (only?.type !== 'text' || rest.length > 0) return
      const stack = byName.get(only.value.trim().toLowerCase())
      if (stack === undefined) return
      const icon: Element =
        stack.iconUrl === null
          ? {
              type: 'element',
              tagName: 'span',
              properties: { dataStackInitial: '', ariaHidden: 'true' },
              children: [{ type: 'text', value: initialOf(stack.displayName) }],
            }
          : {
              type: 'element',
              tagName: 'img',
              // width・height は縦横比（1:1）を伝えるだけ。大きさは MarkdownBody がトークンで決める
              properties: {
                src: stack.iconUrl,
                alt: '',
                width: 1,
                height: 1,
                dataStackIcon: '',
                dataInitial: initialOf(stack.displayName),
              },
              children: [],
            }
      parent.children.splice(index, 0, icon)
      // 入れたアイコンと、照合を済ませた太字を飛ばす
      return [SKIP, index + 2]
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

/**
 * 最上位のブロックに元の行番号を付ける。サニタイズ（GitHub のスキーマは data-* を消す）の後に付けるので、
 * スキーマは広げない。値は構文木の位置から作る数字だけで、本文の文字は入らない
 */
function rehypeSourceLines({ enabled }: { enabled: boolean }) {
  return (tree: Root) => {
    if (!enabled) return
    for (const node of tree.children) {
      const line = node.position?.start.line
      if (node.type === 'element' && line !== undefined) node.properties.dataSourceLine = line
    }
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
    .use(rehypeStackIcons, options.stacks)
    .use(rehypeShiftHeadings)
    .use(rehypeExternalLinks, options.siteOrigin)
    .use(rehypeHighlight, shiki)
    // unified は true を「設定なし」として読むので、真偽値はオブジェクトに包んで渡す
    .use(rehypeSourceLines, { enabled: options.sourceLines === true })
    .use(rehypeStringify)
    .process(markdown)
  return String(file)
}

/**
 * Markdown を描画した HTML（src/markdown/）を出す部品。公開側の本文と管理画面のプレビューで共通（ADR-012）。
 * コードブロックの「コピー」ボタンは描画結果に含めず、ここで付ける。描画結果は UI の言語に依らない形で
 * キャッシュに入るため（ADR-011。キーの言語は本文の言語で、表示中の言語とは限らない）。
 * この部品は描画の関数（Shiki を含む）を import しない。公開側のブラウザのバンドルに Shiki を入れないため
 */
import { useEffect, useRef, useState } from 'react'
import { css, cx } from 'styled-system/css'
import { button } from './recipes'

export interface CopyLabels {
  copy: string
  copied: string
  copyFailed: string
}

export interface MarkdownBodyProps {
  /** サニタイズ済みの HTML（src/markdown/ の描画結果） */
  html: string
  copyLabels: CopyLabels
  /** 本文の言語が表示中の言語と違うとき（代替表示）に付ける */
  lang?: string
  className?: string
}

const body = css({
  display: 'flex',
  flexDirection: 'column',
  gap: 'stack-dense',
  textStyle: 'body',
  overflowWrap: 'anywhere',
  // ページタイトル（h1）は heading-1。本文の見出しは h2 から始まる（src/markdown/render.ts）
  '& h2': { textStyle: 'heading-2', mt: 'stack' },
  '& h3, & h4, & h5, & h6': { textStyle: 'heading-3', mt: 'stack' },
  '& > :first-child': { mt: 'none' },
  '& a': { color: 'accent.default', textDecoration: 'underline', _hover: { color: 'accent.hover' } },
  '& ul': { listStyleType: 'disc', pl: 'gutter' },
  '& ol': { listStyleType: 'decimal', pl: 'gutter' },
  '& li + li': { mt: 'inline' },
  // 脚注の見出し（remark-rehype が sr-only のクラスで出す）は見た目では出さない
  '& .sr-only': { srOnly: true },
  '& .contains-task-list': { listStyleType: 'none', pl: 'none' },
  '& .task-list-item input': { mr: 'inline' },
  '& blockquote': {
    pl: 'inset',
    color: 'text.muted',
    borderLeftWidth: 'emphasis',
    borderLeftStyle: 'solid',
    borderLeftColor: 'border.strong',
  },
  '& hr': { borderTopWidth: 'default', borderTopStyle: 'solid', borderTopColor: 'border.default' },
  // 本文の幅に収める（design-spec 6.3.1）は、preflight の img の max-width: 100% が受け持つ
  '& img': { borderRadius: 'image' },
  '& table': { display: 'block', overflowX: 'auto', borderCollapse: 'collapse', textStyle: 'body-sm' },
  '& th, & td': {
    px: 'inset-dense',
    py: 'inset-dense',
    borderWidth: 'default',
    borderStyle: 'solid',
    borderColor: 'border.default',
    textAlign: 'start',
  },
  '& th': { bg: 'bg.subtle' },
  '& :not(pre) > code': { textStyle: 'code', bg: 'bg.muted', px: 'inline', borderRadius: 'control' },
  '& [data-code-block]': { position: 'relative' },
  '& pre': {
    overflowX: 'auto',
    p: 'inset',
    textStyle: 'code',
    bg: 'bg.subtle',
    borderWidth: 'default',
    borderStyle: 'solid',
    borderColor: 'border.default',
    borderRadius: 'card',
  },
  // Shiki はライト・ダークの色を CSS 変数で出す（src/markdown/highlight.ts）。どちらを使うかはテーマで決める
  '& .shiki span': { color: 'var(--shiki-light)' },
  _dark: { '& .shiki span': { color: 'var(--shiki-dark)' } },
})

const copyButton = cx(
  button({ variant: 'outline' }),
  css({ position: 'absolute', top: 'inset-dense', right: 'inset-dense', h: 'auto', py: 'none', px: 'inset-dense' }),
)

const COPIED_MS = 2000

export function MarkdownBody({ html, copyLabels, lang, className }: MarkdownBodyProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState('')

  // html が変わると React が中身を入れ替えてボタンも消えるので、付け直す
  // biome-ignore lint/correctness/useExhaustiveDependencies: html は effect の中では読まないが、付け直しのきっかけになる
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const timers: ReturnType<typeof setTimeout>[] = []
    const buttons: HTMLButtonElement[] = []
    for (const block of root.querySelectorAll<HTMLElement>('[data-code-block]')) {
      const pre = block.querySelector('pre')
      if (!pre) continue
      const copy = document.createElement('button')
      copy.type = 'button'
      copy.className = copyButton
      copy.textContent = copyLabels.copy
      copy.addEventListener('click', () => {
        const done = (label: string) => {
          copy.textContent = label
          setStatus(label)
          timers.push(
            setTimeout(() => {
              copy.textContent = copyLabels.copy
              setStatus('')
            }, COPIED_MS),
          )
        }
        navigator.clipboard.writeText(pre.textContent ?? '').then(
          () => done(copyLabels.copied),
          () => done(copyLabels.copyFailed),
        )
      })
      block.appendChild(copy)
      buttons.push(copy)
    }
    return () => {
      for (const timer of timers) clearTimeout(timer)
      for (const copy of buttons) copy.remove()
    }
  }, [html, copyLabels.copied, copyLabels.copy, copyLabels.copyFailed])

  return (
    <>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: src/markdown/ が rehype-sanitize を通した HTML だけを受ける */}
      <div ref={ref} lang={lang} className={cx(body, className)} dangerouslySetInnerHTML={{ __html: html }} />
      <p role="status" className={css({ srOnly: true })}>
        {status}
      </p>
    </>
  )
}

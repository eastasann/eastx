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
  '& a': {
    color: 'link.default',
    textDecoration: 'underline',
    textDecorationColor: 'link.underline',
    _hover: { textDecorationColor: 'link.default' },
  },
  // 太字と一致した使用技術のアイコン（src/markdown/render.ts）。行の高さを変えないよう、文字の高さに収める
  '& [data-stack-icon], & [data-stack-initial]': {
    w: 'icon-sm',
    h: 'icon-sm',
    mr: 'inline-tight',
    verticalAlign: 'text-bottom',
  },
  '& [data-stack-icon]': { display: 'inline-block', objectFit: 'contain' },
  '& [data-stack-initial]': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'avatar',
    bg: 'bg.muted',
    color: 'text.muted',
    textStyle: 'label',
    userSelect: 'none',
  },
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
  '& img:not([data-stack-icon])': { borderRadius: 'image' },
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
    // 「コピー」ボタン（copyButton）を上の余白に置き、コードの1行目と重ねない
    pt: 'stack',
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

// button の高さ・余白を上書きするので、cx でクラスを並べず1つの css にまとめる（同じプロパティのクラスは、
// 並べた順ではなくスタイルシートの順で勝ち負けが決まる）
const copyButton = css(button.raw({ variant: 'outline' }), {
  position: 'absolute',
  top: 'none',
  right: 'none',
  h: 'auto',
  py: 'none',
  px: 'inset-dense',
})

const COPIED_MS = 2000

/** 読み込めない本文の画像の代わりの、背景色だけの枠（design-spec 6.1.5・6.2.3。壊れた画像のアイコンを出さない） */
const brokenImageFrame = css({ display: 'block', aspectRatio: 'thumbnail', bg: 'bg.muted', borderRadius: 'image' })

/**
 * 画像を枠に置き換える。代替テキストは枠の読み上げ名に移す。
 * 技術アイコンは、行のアイコンの列と同じく頭文字の丸にする（design-spec 6.1.5）
 */
function replaceWithFrame(image: HTMLImageElement): void {
  if (image.dataset.stackIcon !== undefined) {
    const initial = document.createElement('span')
    initial.dataset.stackInitial = ''
    initial.setAttribute('aria-hidden', 'true')
    initial.textContent = image.dataset.initial ?? ''
    image.replaceWith(initial)
    return
  }
  const frame = document.createElement('span')
  frame.className = brokenImageFrame
  if (image.alt === '') {
    frame.setAttribute('aria-hidden', 'true')
  } else {
    frame.setAttribute('role', 'img')
    frame.setAttribute('aria-label', image.alt)
  }
  image.replaceWith(frame)
}

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
      // 公開側の解析の送信の部品が、この印で押されたことを受ける（src/site/analytics.ts。ui から site を読まないため）
      copy.dataset.codeCopy = ''
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

  // 本文の画像は React の外（innerHTML）にあるので、読み込みの失敗をここで受ける。
  // SSR の HTML の画像は hydrate の前に失敗していることがあるので、読み込みが終わった画像は decode() で確かめる
  // （naturalWidth は、大きさを持たない SVG だと読み込めても 0 になるので使わない）
  // biome-ignore lint/correctness/useExhaustiveDependencies: html は effect の中では読まないが、画像が入れ替わるきっかけになる
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const listeners: [HTMLImageElement, () => void][] = []
    for (const image of root.querySelectorAll('img')) {
      if (image.complete) {
        image.decode().catch(() => {
          if (image.isConnected) replaceWithFrame(image)
        })
        continue
      }
      const onError = () => replaceWithFrame(image)
      image.addEventListener('error', onError, { once: true })
      listeners.push([image, onError])
    }
    return () => {
      for (const [image, onError] of listeners) image.removeEventListener('error', onError)
    }
  }, [html])

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

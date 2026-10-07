/**
 * 管理画面の Markdown のプレビュー（design-spec 6.3.1・6.7.1）。描画は公開側と同じ関数で行う（ADR-012）。
 * 描画の関数は Shiki を含むので、プレビューを初めて出すときに読み込む（ADR-012 のトレードオフ）
 */
import { useEffect, useState } from 'react'
import { css } from 'styled-system/css'
import type { Lang } from '~/i18n/detect'
import type { MarkdownStack } from '~/markdown/render'
import { MarkdownBody } from '~/ui/markdown-body'

/** プレビューの「コピー」ボタンの文言（管理画面は日本語） */
const COPY_LABELS = { copy: 'コピー', copied: 'コピーしました', copyFailed: 'コピーできませんでした' }

/**
 * 打鍵ごとに描き直すと長い本文で入力が重くなるので、打ち終わりを少し待ってから描く。
 * 「すぐ反映する」（design-spec 6.7.1）と読める短さにとどめる
 */
const RENDER_DELAY_MS = 150

type PreviewState = { status: 'pending' } | { status: 'done'; html: string } | { status: 'failed' }

function useRenderedMarkdown(markdown: string, lang: Lang, stacks: MarkdownStack[] | undefined): PreviewState {
  const [state, setState] = useState<PreviewState>({ status: 'pending' })
  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      import('~/markdown/render')
        .then(({ renderMarkdown }) => renderMarkdown(markdown, { lang, siteOrigin: window.location.origin, stacks }))
        .then((html) => {
          if (active) setState({ status: 'done', html })
        })
        .catch(() => {
          if (active) setState({ status: 'failed' })
        })
    }, RENDER_DELAY_MS)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [markdown, lang, stacks])
  return state
}

/**
 * 描画した本文。描き直しのあいだは前の描画を出したままにする（打鍵のたびに「準備しています」へ戻さない）
 */
export function MarkdownPreview({
  markdown,
  lang,
  stacks,
}: {
  markdown: string
  lang: Lang
  stacks?: MarkdownStack[]
}) {
  const state = useRenderedMarkdown(markdown, lang, stacks)
  if (state.status === 'failed') {
    return <p className={css({ textStyle: 'body-sm', color: 'danger.default' })}>プレビューを表示できませんでした</p>
  }
  if (state.status === 'pending') {
    return <p className={css({ textStyle: 'body-sm', color: 'text.muted' })}>プレビューを準備しています…</p>
  }
  return <MarkdownBody html={state.html} copyLabels={COPY_LABELS} lang={lang} />
}

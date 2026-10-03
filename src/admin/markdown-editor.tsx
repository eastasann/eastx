/**
 * L5 の Markdown エディタ（ADR-015）。CodeMirror 6 の EditorView を useEffect で作る自前の薄い部品。
 * 画像を貼り付けるかドロップすると、アップロードしてカーソルの位置（ドロップでは落とした位置）に画像の記法を入れる
 * （design-spec 6.7.1・6.7.4）
 */
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { useEffect, useId, useRef, useState } from 'react'
import { css } from 'styled-system/css'
import type { Lang } from '~/i18n/detect'
import { toaster } from '~/ui/toast'
import { FieldShell, type FieldStateProps, invalidOf, uploadImage, uploadProblem } from './fields'
import { differingRange, UPLOADING_TEXT, uploadMarker } from './markdown-text'

/**
 * 記法の色分け。記号（`#`・`*`・`>`・リンクの URL など）を薄くして本文を目立たせる。
 * 色はトークンのクラスで付け、CodeMirror の既定の配色（トークンにない色）は使わない（ADR-014）
 */
const highlightStyle = HighlightStyle.define([
  {
    tag: [tags.processingInstruction, tags.meta, tags.url, tags.contentSeparator, tags.labelName],
    class: css({ color: 'text.muted' }),
  },
  { tag: tags.monospace, class: css({ bg: 'bg.muted', borderRadius: 'control' }) },
  { tag: tags.emphasis, class: css({ fontStyle: 'italic' }) },
  { tag: tags.strikethrough, class: css({ textDecoration: 'line-through' }) },
  { tag: tags.quote, class: css({ color: 'text.muted' }) },
])

// CodeMirror は自分の基本のスタイルを CSS のレイヤーの外に入れる。レイヤーの外の宣言は Panda のレイヤーの中の宣言に
// 詳細度に関わらず勝つので、CodeMirror が値を持つプロパティ（余白・高さ・キャレットの色・フォント・フォーカスの枠）は
// !important で上書きする。キャレットの色を上書きしないと、ダークモードでも CodeMirror のライトの黒のままになる
const frame = css({
  textStyle: 'code',
  bg: 'surface.default',
  borderWidth: 'default',
  borderStyle: 'solid',
  borderColor: 'border.strong',
  borderRadius: 'control',
  // CodeMirror のフォーカスの枠は消し、入力欄と同じ輪を枠に出す
  _focusWithin: { outlineWidth: 'focus-ring', outlineStyle: 'solid', outlineColor: 'focus-ring' },
  '&[data-invalid=true]': { borderColor: 'danger.default' },
  '& .cm-editor.cm-focused': { outline: 'none !important' },
  '& .cm-scroller': { fontFamily: 'inherit !important', lineHeight: 'inherit !important' },
  // 本文が短くても、枠の中のどこを押してもエディタに入れるよう、入力の要素そのものに高さを持たせる
  '& .cm-content': {
    minH: 'editor !important',
    p: 'inset-dense !important',
    caretColor: 'text.default !important',
  },
})

/** 画像の記法の代替テキスト。ファイル名から拡張子を落とし、記法を壊す文字を除く（あとから本文で直せる） */
function altOf(file: File): string {
  return file.name.replace(/\.[^.]+$/, '').replace(/[[\]\\]/g, '')
}

function contentAttributes(labelId: string, describedBy: string, invalid: boolean, lang: Lang) {
  return EditorView.contentAttributes.of({
    'aria-labelledby': labelId,
    'aria-describedby': describedBy,
    'aria-invalid': String(invalid),
    lang,
  })
}

export interface MarkdownEditorProps extends FieldStateProps {
  label: string
  value: string
  onChange: (value: string) => void
  /** 本文の言語（読み上げとスペルチェックの言語） */
  lang: Lang
  /** 隠しているあいだ（もう一方の言語のエディタ）は描いたまま見せない。描き直すと元に戻す履歴が消えるため */
  hidden?: boolean
  /** 画像のアップロード中かが変わったとき。アップロード中は保存させない（design-spec 6.7.4） */
  onUploadingChange?: (uploading: boolean) => void
}

export function MarkdownEditor({
  label,
  value,
  onChange,
  lang,
  hidden = false,
  onUploadingChange,
  ...state
}: MarkdownEditorProps) {
  const id = useId()
  const labelId = `${id}-label`
  const describedBy = `${id}-desc`
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const [uploading, setUploading] = useState(0)
  const onUploadingChangeRef = useRef(onUploadingChange)
  onUploadingChangeRef.current = onUploadingChange
  useEffect(() => {
    onUploadingChangeRef.current?.(uploading > 0)
  }, [uploading])
  const invalid = invalidOf(state)
  const [attributes] = useState(() => new Compartment())

  // エディタは1度だけ作る。値の入れ替え（保存後・一時保存の復元）と属性の変更は、下の effect で今のエディタへ送る
  // biome-ignore lint/correctness/useExhaustiveDependencies: 作り直すと入力の途中の状態と元に戻す履歴が消える
  useEffect(() => {
    const parent = host.current
    if (!parent) return

    /** 仮の記法を、画像の記法（失敗したら空）に置き換える */
    function settle(view: EditorView, marker: string, replacement: string) {
      // 編集ビューを離れてエディタがなくなっていたら、入れる先がないので何もしない
      if (viewRef.current !== view) return
      const from = view.state.doc.toString().indexOf(marker)
      // 仮の記法を消されていたら、入れる場所がないので何もしない
      if (from !== -1) view.dispatch({ changes: { from, to: from + marker.length, insert: replacement } })
    }

    async function upload(view: EditorView, file: File, marker: string) {
      setUploading((count) => count + 1)
      const url = await uploadImage(file)
      setUploading((count) => count - 1)
      settle(view, marker, url === null ? '' : `![${altOf(file)}](${url})`)
    }

    function handleFiles(view: EditorView, files: FileList | undefined | null, pos: number): boolean {
      if (!files || files.length === 0) return false
      const accepted: { file: File; marker: string }[] = []
      for (const file of files) {
        const problem = uploadProblem(file)
        if (problem !== null) toaster.create({ title: problem, type: 'error' })
        // 仮の記法。終わったら本文の中から探して置き換える（アップロードのあいだに前後が書き換わっても位置がずれない）
        else accepted.push({ file, marker: uploadMarker() })
      }
      // 複数のファイルは選んだ順に並べたいので、仮の記法をまとめて1回で入れる
      const insert = accepted.map(({ marker }) => marker).join('\n')
      if (insert !== '') {
        view.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length } })
        for (const { file, marker } of accepted) void upload(view, file, marker)
      }
      return true
    }

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          // Tab はフォーカスの移動に残す（インデントにしない）。キーボードだけでエディタから抜けられるように
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown(),
          syntaxHighlighting(highlightStyle),
          EditorView.lineWrapping,
          attributes.of(contentAttributes(labelId, describedBy, invalid, lang)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          }),
          EditorView.domEventHandlers({
            paste(event, view) {
              if (!handleFiles(view, event.clipboardData?.files, view.state.selection.main.head)) return false
              event.preventDefault()
              return true
            },
            drop(event, view) {
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head
              if (!handleFiles(view, event.dataTransfer?.files, pos)) return false
              event.preventDefault()
              return true
            },
          }),
        ],
      }),
    })
    viewRef.current = view
    return () => {
      viewRef.current = null
      view.destroy()
    }
  }, [])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: attributes.reconfigure(contentAttributes(labelId, describedBy, invalid, lang)),
    })
  }, [attributes, labelId, describedBy, invalid, lang])

  // フォームの値がエディタの外で変わったとき（保存後の読み直し・一時保存の復元）だけ、エディタの中身を入れ替える。
  // 自分の入力で変わった値は、エディタの中身と同じなので何もしない。
  // 全体を入れ替えるとカーソルが飛ぶので、前後の同じ部分を残して違う部分だけを入れ替える
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) view.dispatch({ changes: differingRange(current, value) })
  }, [value])

  return (
    <div hidden={hidden}>
      <FieldShell
        label={label}
        labelId={labelId}
        describedBy={describedBy}
        hint={uploading > 0 ? <span role="status">{UPLOADING_TEXT}</span> : '画像は貼り付けるかドロップすると入ります'}
        {...state}
      >
        <div ref={host} className={frame} data-invalid={invalid} />
      </FieldShell>
    </div>
  )
}

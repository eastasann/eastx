/**
 * L5 の Markdown エディタ（ADR-015）。CodeMirror 6 の EditorView を useEffect で作る自前の薄い部品。
 * 画像を貼り付けるか、ドロップするか、「画像を挿入」で選ぶと、アップロードしてカーソルの位置（ドロップでは落とした位置）に
 * 画像の記法を入れる（design-spec 6.7.1・6.7.4）。Cmd/Ctrl+F で本文の中を検索する
 */
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { type ChangeEvent, useEffect, useId, useRef, useState } from 'react'
import { css } from 'styled-system/css'
import { UPLOAD_CONTENT_TYPES } from '~/api/contract/misc'
import type { Lang } from '~/i18n/detect'
import { ImageIcon } from '~/ui/icons'
import { button } from '~/ui/recipes'
import { toaster } from '~/ui/toast'
import { useReportBusy } from './editor'
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

/** 検索のパネルの文言（管理画面は日本語） */
const SEARCH_PHRASES = EditorState.phrases.of({
  Find: '検索',
  Replace: '置換',
  next: '次へ',
  previous: '前へ',
  all: 'すべて選ぶ',
  'match case': '大文字小文字を区別',
  regexp: '正規表現',
  'by word': '単語単位',
  replace: '置換',
  'replace all': 'すべて置換',
  close: '閉じる',
  'current match': '今の一致',
  'on line': '行',
})

// CodeMirror は自分の基本のスタイルを CSS のレイヤーの外に入れる。レイヤーの外の宣言は Panda のレイヤーの中の宣言に
// 詳細度に関わらず勝つので、CodeMirror が値を持つプロパティ（余白・高さ・キャレットの色・フォント・フォーカスの枠、
// 検索のパネルの色と枠）は !important で上書きする。キャレットの色を上書きしないと、ダークモードでも CodeMirror の
// ライトの黒のままになる
const frame = css({
  display: 'flex',
  flexDirection: 'column',
  textStyle: 'code',
  bg: 'surface.default',
  borderWidth: 'default',
  borderStyle: 'solid',
  borderColor: 'border.strong',
  borderRadius: 'control',
  overflow: 'hidden',
  // CodeMirror のフォーカスの枠は消し、入力欄と同じ輪を枠に出す
  _focusWithin: { outlineWidth: 'focus-ring', outlineStyle: 'solid', outlineColor: 'focus-ring' },
  '&[data-invalid=true]': { borderColor: 'danger.default' },
  // 縦の flex の子は既定で中身の高さより縮まないので、overflow で縮めて、スクロールを .cm-scroller の中に収める
  '& .cm-editor': { flex: '1', overflow: 'hidden' },
  '& .cm-editor.cm-focused': { outline: 'none !important' },
  '& .cm-scroller': { fontFamily: 'inherit !important', lineHeight: 'inherit !important', overflowY: 'auto' },
  // 本文が短くても、枠の中のどこを押してもエディタに入れるよう、入力の要素そのものに高さを持たせる
  '& .cm-content': {
    minH: 'editor !important',
    p: 'inset-dense !important',
    caretColor: 'text.default !important',
  },
  '& .cm-panels': {
    bg: 'bg.canvas !important',
    color: 'text.default !important',
    borderColor: 'border.default !important',
  },
  '& .cm-panel.cm-search': { p: 'inset-dense !important' },
  '& .cm-button': {
    fontSize: 'inherit !important',
    backgroundImage: 'none !important',
    bg: 'surface.default !important',
    borderColor: 'border.strong !important',
    borderRadius: 'control !important',
  },
  '& .cm-textfield': {
    fontSize: 'inherit !important',
    bg: 'surface.default !important',
    borderColor: 'border.strong !important',
    borderRadius: 'control !important',
  },
  '& .cm-searchMatch': { bg: 'bg.muted !important' },
  '& .cm-searchMatch-selected': {
    outlineWidth: 'default',
    outlineStyle: 'solid',
    outlineColor: 'border.strong',
  },
  // 画面の高さに収める表示（768px 以上）では、枠が残りの高さを埋め、エディタの中でスクロールする
  flex: '1',
})

/** 画像の記法の代替テキスト。ファイル名から拡張子を落とし、記法を壊す文字を除く（あとから本文で直せる） */
function altOf(file: File): string {
  return file.name.replace(/\.[^.]+$/, '').replace(/[[\]\\]/g, '')
}

function contentAttributes(labelId: string, describedBy: string, invalid: boolean, lang: Lang) {
  return EditorView.contentAttributes.of({
    // 入力の要素は contenteditable で元からフォーカスできるが、明示しないと、エディタの中でスクロールする枠を
    // 「キーボードで届かないスクロール領域」と判定する検査（axe の scrollable-region-focusable）がある
    tabindex: '0',
    'aria-labelledby': labelId,
    'aria-describedby': describedBy,
    'aria-invalid': String(invalid),
    lang,
  })
}

export interface MarkdownEditorProps extends FieldStateProps {
  label: string
  /** 欄のキー（`ja.body`）。誤りの欄へ移るときの目印 */
  name: string
  value: string
  onChange: (value: string) => void
  /** 本文の言語（読み上げとスペルチェックの言語） */
  lang: Lang
  /** 見えている先頭の行（1始まり）が変わったとき。「並べる」のプレビューの追従に使う */
  onTopLineChange?: (line: number) => void
}

export function MarkdownEditor({ label, name, value, onChange, lang, onTopLineChange, ...state }: MarkdownEditorProps) {
  const id = useId()
  const labelId = `${id}-label`
  const describedBy = `${id}-desc`
  const host = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onTopLineRef = useRef(onTopLineChange)
  onTopLineRef.current = onTopLineChange
  /** 選んだファイルを今のカーソルの位置に入れる（「画像を挿入」） */
  const insertFilesRef = useRef<(files: FileList) => void>(() => {})
  const [uploading, setUploading] = useState(0)
  const reportBusy = useReportBusy('upload')
  useEffect(() => {
    reportBusy(uploading > 0)
  }, [uploading, reportBusy])
  const invalid = invalidOf(state)
  const [attributes] = useState(() => new Compartment())

  // エディタは1度だけ作る。値の入れ替え（保存後・退避の復元）と属性の変更は、下の effect で今のエディタへ送る
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

    function reportTopLine(view: EditorView) {
      const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop)
      onTopLineRef.current?.(view.state.doc.lineAt(block.from).number)
    }

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          search({ top: true }),
          SEARCH_PHRASES,
          // Cmd/Ctrl+S は編集ビューの最上位（editor.tsx の useSaveShortcut）が保存する。ここでは既定の動きを止めるだけで、
          // 打鍵は止めずに上へ届ける（stopPropagation しない）
          // Tab はフォーカスの移動に残す（インデントにしない）。キーボードだけでエディタから抜けられるように
          keymap.of([{ key: 'Mod-s', run: () => true }, ...searchKeymap, ...defaultKeymap, ...historyKeymap]),
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
            scroll(_event, view) {
              reportTopLine(view)
            },
          }),
        ],
      }),
    })
    viewRef.current = view
    insertFilesRef.current = (files) => {
      handleFiles(view, files, view.state.selection.main.head)
      view.focus()
    }
    return () => {
      viewRef.current = null
      insertFilesRef.current = () => {}
      view.destroy()
    }
  }, [])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: attributes.reconfigure(contentAttributes(labelId, describedBy, invalid, lang)),
    })
  }, [attributes, labelId, describedBy, invalid, lang])

  // フォームの値がエディタの外で変わったとき（保存後の読み直し・退避の復元）だけ、エディタの中身を入れ替える。
  // 自分の入力で変わった値は、エディタの中身と同じなので何もしない。
  // 全体を入れ替えるとカーソルが飛ぶので、前後の同じ部分を残して違う部分だけを入れ替える
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) view.dispatch({ changes: differingRange(current, value) })
  }, [value])

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files
    if (files && files.length > 0) insertFilesRef.current(files)
    // 同じファイルを選び直しても change が起きるよう、選択を空に戻す
    event.target.value = ''
  }

  return (
    <FieldShell
      label={label}
      labelId={labelId}
      describedBy={describedBy}
      field={name}
      fill
      hint={
        <span className={css({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'inline' })}>
          <button type="button" onClick={() => fileInput.current?.click()} className={button({ variant: 'ghost' })}>
            <ImageIcon size="sm" />
            画像を挿入
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={UPLOAD_CONTENT_TYPES.join(',')}
            multiple
            tabIndex={-1}
            aria-hidden="true"
            onChange={handleFile}
            className={css({ srOnly: true })}
          />
          {uploading > 0 ? <span role="status">{UPLOADING_TEXT}</span> : '画像は貼り付け・ドロップでも入ります'}
        </span>
      }
      {...state}
    >
      <div ref={host} className={frame} data-invalid={invalid} />
    </FieldShell>
  )
}

/**
 * 編集ビューの入力欄（design-spec 6.7）。欄の下に入力チェックの理由（赤字）と、公開に足りない項目の印を出す（6.7.3）。
 * 値は文字列で持ち、空文字のまま API に送る（サーバーが空を null にする。SDD 5.0）。
 * 欄の外枠は `data-field` に欄のキー（fieldErrors のキー）を持ち、保存しようとして誤りがあったときの移り先になる
 */
import { type ChangeEvent, type DragEvent, type ReactNode, useId, useRef, useState } from 'react'
import { css } from 'styled-system/css'
import { UPLOAD_CONTENT_TYPES, UPLOAD_MAX_BYTES, UPLOAD_MESSAGES } from '~/api/contract/misc'
import type { Lang } from '~/i18n/detect'
import type { MarkdownStack } from '~/markdown/render'
import { FallbackImage } from '~/ui/image'
import { button, input } from '~/ui/recipes'
import { Select, type SelectOption } from '~/ui/select'
import { Switch } from '~/ui/switch'
import { toaster } from '~/ui/toast'
import { api } from './api'
import { useReportBusy } from './editor'
import { counterState } from './editor-rules'
import { fieldKey, isAuthError, saveFailureOf } from './errors'
import { MarkdownPreview } from './markdown-preview'

export interface FieldStateProps {
  /** 入力チェックの理由（design-spec 6.7.3） */
  errors?: string[]
  /** 公開に足りない項目（PUBLISH_REQUIREMENTS_NOT_MET）に入っている */
  missing?: boolean
}

interface ShellProps extends FieldStateProps {
  label: string
  /** 見えるラベルを出さない（枠の無い欄。読み上げの名前は入力欄の aria-label で付ける） */
  hideLabel?: boolean
  htmlFor?: string
  /** label 要素に結びつけられない入力欄（CodeMirror）が aria-labelledby で読む ID */
  labelId?: string
  hint?: ReactNode
  /** 欄の右下の文字数（design-spec 6.7.3） */
  counter?: { text: string; over: boolean } | null
  /** 欄の下の文（hint とエラーの読み上げ）を入力欄と結びつけるための ID */
  describedBy: string
  /** 欄のキー（fieldErrors のキー）。誤りの欄へ移るときの目印 */
  field?: string
  /** 親の残りの高さを埋める（L5 の本文のエディタ） */
  fill?: boolean
  children: ReactNode
}

const MISSING_MESSAGE = '公開に必要です'

/** 入力欄のラベル。小さなグレーの文字（design-spec 4.4） */
export const fieldLabel = css({ textStyle: 'label', color: 'text.muted' })

export function FieldShell({
  label,
  hideLabel = false,
  htmlFor,
  labelId,
  hint,
  counter,
  errors = [],
  missing = false,
  describedBy,
  field,
  fill = false,
  children,
}: ShellProps) {
  const messages = [...errors, ...(missing && errors.length === 0 ? [MISSING_MESSAGE] : [])]
  return (
    <div
      data-field={field}
      data-fill={fill}
      className={css({
        display: 'flex',
        flexDirection: 'column',
        gap: 'inline',
        '&[data-fill=true]': { flex: '1', tablet: { overflow: 'hidden' } },
      })}
    >
      <label id={labelId} htmlFor={htmlFor} className={hideLabel ? css({ srOnly: true }) : fieldLabel}>
        {label}
      </label>
      {children}
      <div
        id={describedBy}
        className={css({
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          columnGap: 'inline',
          _empty: { display: 'none' },
        })}
      >
        {(hint !== undefined || messages.length > 0) && (
          <div className={css({ display: 'flex', flexDirection: 'column', gap: 'inline', flex: '1' })}>
            {hint !== undefined && <div className={css({ textStyle: 'body-sm', color: 'text.muted' })}>{hint}</div>}
            {messages.map((message) => (
              <p key={message} className={css({ textStyle: 'body-sm', color: 'danger.default' })}>
                {message}
              </p>
            ))}
          </div>
        )}
        {counter && (
          <p
            data-over={counter.over}
            className={css({
              ml: 'auto',
              textStyle: 'meta',
              color: 'text.muted',
              '&[data-over=true]': { color: 'danger.default' },
            })}
          >
            {counter.text}
          </p>
        )}
      </div>
    </div>
  )
}

export function invalidOf({ errors = [], missing = false }: FieldStateProps): boolean {
  return errors.length > 0 || missing
}

export interface TextFieldProps extends FieldStateProps {
  label: string
  value: string
  onChange: (value: string) => void
  /** 入力欄の name（API の fieldErrors のキー。ADR-008） */
  name: string
  type?: 'text' | 'url' | 'month' | 'datetime-local'
  /** 日付・日時の欄の上限 */
  max?: string
  /** 文字数の上限。8割を超えたら文字数を出す（入力は止めない。保存の入力チェックで止まる） */
  limit?: number
  placeholder?: string
  hint?: ReactNode
  disabled?: boolean
  lang?: Lang
  /**
   * 枠の無い入力（L5 のエディタの上のタイトル・概要。design-spec 4.4）。見えるラベルを出さず、
   * 空のときは欄の名前を placeholder に出す
   */
  bare?: 'title' | 'summary'
}

export function TextField({
  label,
  value,
  onChange,
  name,
  type = 'text',
  max,
  limit,
  placeholder,
  hint,
  disabled,
  lang,
  bare,
  ...state
}: TextFieldProps) {
  const id = useId()
  return (
    <FieldShell
      label={label}
      hideLabel={bare !== undefined}
      htmlFor={id}
      hint={hint}
      counter={limit === undefined ? null : counterState(value, limit)}
      describedBy={`${id}-desc`}
      field={fieldKey(name)}
      {...state}
    >
      <input
        id={id}
        name={name}
        type={type}
        max={max}
        value={value}
        placeholder={bare !== undefined ? label : placeholder}
        disabled={disabled}
        lang={lang}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalidOf(state)}
        aria-describedby={`${id}-desc`}
        className={input({ bare: bare ?? 'none' })}
      />
    </FieldShell>
  )
}

export interface TextAreaFieldProps extends Omit<TextFieldProps, 'type' | 'max' | 'placeholder'> {
  rows?: number
}

export interface MarkdownFieldProps extends Omit<TextAreaFieldProps, 'limit' | 'bare'> {
  /** プレビューで太字と照合する使用技術。自己紹介だけが渡す（ADR-012） */
  stacks?: MarkdownStack[]
}

export function TextAreaField({
  label,
  value,
  onChange,
  name,
  rows = 4,
  limit,
  hint,
  disabled,
  lang,
  bare,
  ...state
}: TextAreaFieldProps) {
  const id = useId()
  return (
    <FieldShell
      label={label}
      hideLabel={bare !== undefined}
      htmlFor={id}
      hint={hint}
      counter={limit === undefined ? null : counterState(value, limit)}
      describedBy={`${id}-desc`}
      field={fieldKey(name)}
      {...state}
    >
      <textarea
        id={id}
        name={name}
        rows={rows}
        value={value}
        placeholder={bare !== undefined ? label : undefined}
        disabled={disabled}
        lang={lang}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalidOf(state)}
        aria-describedby={`${id}-desc`}
        className={input({ multiline: true, bare: bare ?? 'none' })}
      />
    </FieldShell>
  )
}

/**
 * Markdown の欄（L6）。ボタンで入力とプレビューを切り替える（design-spec 4.1・6.7.1）
 */
export function MarkdownField({
  label,
  value,
  onChange,
  name,
  rows = 8,
  disabled,
  lang = 'ja',
  stacks,
  ...state
}: MarkdownFieldProps) {
  const [preview, setPreview] = useState(false)

  return (
    <div className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}>
      <div className={css({ display: 'flex', justifyContent: 'flex-end' })}>
        <button
          type="button"
          onClick={() => setPreview((current) => !current)}
          aria-pressed={preview}
          className={button({ variant: 'ghost' })}
        >
          {preview ? '入力に戻る' : 'プレビュー'}
        </button>
      </div>
      {preview ? (
        <section
          aria-label={`${label}のプレビュー`}
          data-field={fieldKey(name)}
          className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}
        >
          <p className={fieldLabel}>{label}（プレビュー）</p>
          <div
            className={css({
              p: 'inset',
              borderWidth: 'default',
              borderStyle: 'solid',
              borderColor: 'border.default',
              borderRadius: 'control',
            })}
          >
            <MarkdownPreview markdown={value} lang={lang} stacks={stacks} />
          </div>
        </section>
      ) : (
        <TextAreaField
          label={label}
          value={value}
          onChange={onChange}
          name={name}
          rows={rows}
          disabled={disabled}
          lang={lang}
          {...state}
        />
      )}
    </div>
  )
}

export interface SelectFieldProps extends FieldStateProps {
  label: string
  name: string
  options: SelectOption[]
  value: string
  onChange: (value: string) => void
}

export function SelectField({ label, name, options, value, onChange, ...state }: SelectFieldProps) {
  const errors = state.errors ?? []
  const messages = [...errors, ...(state.missing && errors.length === 0 ? [MISSING_MESSAGE] : [])]
  return (
    <div data-field={fieldKey(name)} className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}>
      <Select
        label={label}
        name={name}
        options={options}
        value={value}
        // 選び直すことはできても空にはできない欄なので、外したときは今の値のまま
        onValueChange={(next) => {
          if (next !== null) onChange(next)
        }}
        invalid={invalidOf(state)}
      />
      <div>
        {messages.map((message) => (
          <p key={message} className={css({ textStyle: 'body-sm', color: 'danger.default' })}>
            {message}
          </p>
        ))}
      </div>
    </div>
  )
}

export function SwitchField({
  label,
  name,
  checked,
  onChange,
  disabled,
  hint,
  descriptionId,
  alsoDescribedBy,
  errors = [],
}: {
  label: string
  name: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  /** 欄の下に出す説明（A7 の Core の「Core の技術はトップに表示します」） */
  hint?: string
  /** 欄の下の要素の ID。ほかの欄から説明として指すときに渡す */
  descriptionId?: string
  /** ほかの欄の説明も読ませるときの、その要素の ID（押せなくした理由がほかの欄の下にあるとき） */
  alsoDescribedBy?: string
} & Pick<FieldStateProps, 'errors'>) {
  const generatedId = useId()
  const describedBy = descriptionId ?? generatedId
  const described = hint !== undefined || errors.length > 0
  const describedByIds = [described ? describedBy : undefined, alsoDescribedBy].filter(Boolean).join(' ')
  return (
    <div data-field={name} className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}>
      <Switch
        label={label}
        name={name}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        invalid={errors.length > 0}
        describedBy={describedByIds === '' ? undefined : describedByIds}
      />
      {described && (
        <div id={describedBy} className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}>
          {hint !== undefined && <p className={css({ textStyle: 'body-sm', color: 'text.muted' })}>{hint}</p>}
          {errors.map((message) => (
            <p key={message} className={css({ textStyle: 'body-sm', color: 'danger.default' })}>
              {message}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

/** アップロードの前の確かめ（design-spec 6.7.3）。サーバーも同じ上限と形式で確かめる（SDD 5.10） */
export function uploadProblem(file: { type: string; size: number }): string | null {
  if (!(UPLOAD_CONTENT_TYPES as readonly string[]).includes(file.type)) return UPLOAD_MESSAGES.notImage
  if (file.size > UPLOAD_MAX_BYTES) return UPLOAD_MESSAGES.tooLarge
  return null
}

/** 画像を1つアップロードして URL を返す。失敗したら理由を通知して null（design-spec 6.7.4） */
export async function uploadImage(file: File): Promise<string | null> {
  const problem = uploadProblem(file)
  if (problem !== null) {
    toaster.create({ title: problem, type: 'error' })
    return null
  }
  try {
    const result = await api.uploads.create({ file })
    return result.url
  } catch (error) {
    if (isAuthError(error)) return null
    const failure = saveFailureOf(error)
    const reason = failure.kind === 'invalid' ? (failure.fieldErrors.file?.[0] ?? failure.formErrors[0]) : undefined
    toaster.create({ title: reason ?? 'アップロードできませんでした', type: 'error' })
    return null
  }
}

export interface ImageFieldProps extends FieldStateProps {
  label: string
  name: string
  value: string
  onChange: (value: string) => void
  /** プレビューの代替テキスト（design-spec 4.4） */
  alt: string
  /**
   * プレビューの見せ方。`thumbnail` は公開側と同じ縦横比（aspectRatios.thumbnail）で切り抜いて、公開側でどこが
   * 切れるかを見せる。`contain` は全体を縮めて見せる（写真・技術アイコン）
   */
  fit?: 'thumbnail' | 'contain'
}

/**
 * 画像の欄（サムネイル・写真・技術アイコン。design-spec 6.7.1・6.7.4）。選ぶかドラッグ＆ドロップでアップロードする。
 * 設定済みの画像はプレビューで見せ、「差し替える」「外す」を置く。アップロードに失敗したら元の画像を残す。
 * アップロード中は保存を待たせる（終わる前に保存すると古い画像のまま保存する）
 */
export function ImageField({ label, name, value, onChange, alt, fit = 'contain', ...state }: ImageFieldProps) {
  const id = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const reportBusy = useReportBusy('upload')

  async function upload(file: File | undefined) {
    if (!file) return
    // 欄が描き直されても（設定パネルの置き場所が変わる）アップロードは続くので、待たせるのは state ではなく
    // アップロードの前後で直接知らせる
    reportBusy(true)
    setUploading(true)
    const url = await uploadImage(file)
    setUploading(false)
    reportBusy(false)
    if (url !== null) onChange(url)
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    void upload(event.target.files?.[0])
    // 同じファイルを選び直しても change が起きるよう、選択を空に戻す
    event.target.value = ''
  }

  function handleDrop(event: DragEvent<HTMLFieldSetElement>) {
    event.preventDefault()
    setDragOver(false)
    void upload(event.dataTransfer.files[0])
  }

  return (
    <FieldShell label={label} htmlFor={id} describedBy={`${id}-desc`} field={fieldKey(name)} {...state}>
      <fieldset
        aria-label={`${label}のドロップ先`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        aria-busy={uploading}
        data-drag-over={dragOver}
        className={css({
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 'inline',
          p: 'inset-dense',
          borderWidth: 'default',
          borderStyle: 'dashed',
          borderColor: 'border.strong',
          borderRadius: 'control',
          '&[data-drag-over=true]': { borderColor: 'text.default', bg: 'bg.muted' },
        })}
      >
        {value !== '' && (
          <FallbackImage
            src={value}
            alt={alt}
            className={css({ w: 'thumbnail-card', aspectRatio: 'thumbnail', borderRadius: 'image' })}
            fit={fit === 'thumbnail' ? 'cover' : 'contain'}
          />
        )}
        <input
          ref={fileInput}
          id={id}
          name={name}
          type="file"
          accept={UPLOAD_CONTENT_TYPES.join(',')}
          onChange={handleFile}
          aria-describedby={`${id}-desc`}
          className={css({ srOnly: true })}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
          className={button({ variant: 'outline' })}
        >
          {value === '' ? '画像を選ぶ' : '差し替える'}
        </button>
        {value !== '' && (
          <button
            type="button"
            onClick={() => onChange('')}
            disabled={uploading}
            className={button({ variant: 'ghost' })}
          >
            外す
          </button>
        )}
        <span role="status" className={css({ textStyle: 'body-sm', color: 'text.muted' })}>
          {uploading ? 'アップロード中…' : value === '' ? 'またはここにドロップ' : ''}
        </span>
      </fieldset>
    </FieldShell>
  )
}

/**
 * 編集ビューの入力欄（design-spec 6.7）。欄の下に入力チェックの理由（赤字）と、公開に足りない項目の印を出す（6.7.3）。
 * 値は文字列で持ち、空文字のまま API に送る（サーバーが空を null にする。SDD 5.0）
 */
import { type ChangeEvent, type DragEvent, type ReactNode, useId, useRef, useState } from 'react'
import { css, cx } from 'styled-system/css'
import { UPLOAD_CONTENT_TYPES, UPLOAD_MAX_BYTES, UPLOAD_MESSAGES } from '~/api/contract/misc'
import type { Lang } from '~/i18n/detect'
import { FallbackImage } from '~/ui/image'
import { button, input } from '~/ui/recipes'
import { Select, type SelectOption } from '~/ui/select'
import { Switch } from '~/ui/switch'
import { toaster } from '~/ui/toast'
import { api } from './api'
import { isAuthError, saveFailureOf } from './errors'
import { MarkdownPreview } from './markdown-preview'

export interface FieldStateProps {
  /** 入力チェックの理由（design-spec 6.7.3） */
  errors?: string[]
  /** 公開に足りない項目（PUBLISH_REQUIREMENTS_NOT_MET）に入っている */
  missing?: boolean
}

interface ShellProps extends FieldStateProps {
  label: string
  htmlFor?: string
  /** label 要素に結びつけられない入力欄（CodeMirror）が aria-labelledby で読む ID */
  labelId?: string
  hint?: ReactNode
  /** 欄の下の文（hint とエラーの読み上げ）を入力欄と結びつけるための ID */
  describedBy: string
  children: ReactNode
}

const MISSING_MESSAGE = '公開に必要です'

export function FieldShell({
  label,
  htmlFor,
  labelId,
  hint,
  errors = [],
  missing = false,
  describedBy,
  children,
}: ShellProps) {
  const messages = [...errors, ...(missing && errors.length === 0 ? [MISSING_MESSAGE] : [])]
  return (
    <div className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}>
      <label id={labelId} htmlFor={htmlFor} className={css({ textStyle: 'label' })}>
        {label}
      </label>
      {children}
      <div id={describedBy} className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}>
        {hint !== undefined && <p className={css({ textStyle: 'body-sm', color: 'text.muted' })}>{hint}</p>}
        {messages.map((message) => (
          <p key={message} className={css({ textStyle: 'body-sm', color: 'danger.default' })}>
            {message}
          </p>
        ))}
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
  placeholder?: string
  hint?: ReactNode
  disabled?: boolean
  lang?: Lang
}

export function TextField({
  label,
  value,
  onChange,
  name,
  type = 'text',
  max,
  placeholder,
  hint,
  disabled,
  lang,
  ...state
}: TextFieldProps) {
  const id = useId()
  return (
    <FieldShell label={label} htmlFor={id} hint={hint} describedBy={`${id}-desc`} {...state}>
      <input
        id={id}
        name={name}
        type={type}
        max={max}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        lang={lang}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalidOf(state)}
        aria-describedby={`${id}-desc`}
        className={input()}
      />
    </FieldShell>
  )
}

export interface TextAreaFieldProps extends Omit<TextFieldProps, 'type' | 'max'> {
  rows?: number
}

export function TextAreaField({
  label,
  value,
  onChange,
  name,
  rows = 4,
  hint,
  disabled,
  lang,
  ...state
}: TextAreaFieldProps) {
  const id = useId()
  return (
    <FieldShell label={label} htmlFor={id} hint={hint} describedBy={`${id}-desc`} {...state}>
      <textarea
        id={id}
        name={name}
        rows={rows}
        value={value}
        disabled={disabled}
        lang={lang}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalidOf(state)}
        aria-describedby={`${id}-desc`}
        className={input({ multiline: true })}
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
  ...state
}: TextAreaFieldProps) {
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
          className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}
        >
          <p className={css({ textStyle: 'label' })}>{label}（プレビュー）</p>
          <div
            className={css({
              p: 'inset',
              borderWidth: 'default',
              borderStyle: 'solid',
              borderColor: 'border.default',
              borderRadius: 'control',
            })}
          >
            <MarkdownPreview markdown={value} lang={lang} />
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
    <div className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}>
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
}: {
  label: string
  name: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return <Switch label={label} name={name} checked={checked} onCheckedChange={onChange} />
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
}

/**
 * 画像の欄（サムネイル・写真・技術アイコン。design-spec 6.7.1・6.7.4）。選ぶかドラッグ＆ドロップでアップロードする。
 * 設定済みの画像はプレビューで見せ、「差し替える」「外す」を置く。アップロードに失敗したら元の画像を残す
 */
export function ImageField({ label, name, value, onChange, alt, ...state }: ImageFieldProps) {
  const id = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  async function upload(file: File | undefined) {
    if (!file) return
    setUploading(true)
    const url = await uploadImage(file)
    setUploading(false)
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
    <FieldShell label={label} htmlFor={id} describedBy={`${id}-desc`} {...state}>
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
          '&[data-drag-over=true]': { borderColor: 'accent.default', bg: 'accent.subtle' },
        })}
      >
        {value !== '' && (
          <FallbackImage
            src={value}
            alt={alt}
            className={css({
              w: 'thumbnail-card',
              aspectRatio: 'thumbnail',
              objectFit: 'contain',
              borderRadius: 'image',
            })}
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
        <span role="status" className={cx(css({ textStyle: 'body-sm', color: 'text.muted' }))}>
          {uploading ? 'アップロード中…' : value === '' ? 'またはここにドロップ' : ''}
        </span>
      </fieldset>
    </FieldShell>
  )
}

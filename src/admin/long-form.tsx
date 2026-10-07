/**
 * L5 の編集ビュー（A5・A6・A8・A9）で共通の部品（design-spec 6.7.1・6.7.2）:
 * - 本文のエディタとプレビュー（言語タブで選んだ言語の本文）
 * - スラッグの欄（英語のタイトルからの自動の生成と追従、形式と重複の確かめ、公開したことがあるものの変更の警告）
 * - 使用技術の選択（A5・A6。検索して選ぶ、新しい技術として追加、チップの並べ替え）
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { css, cx } from 'styled-system/css'
import { optionalSlug, slugConflictError } from '~/api/contract/common'
import type { SLUG_TYPES } from '~/api/contract/misc'
import { stackCreateInput } from '~/api/contract/stacks'
import { slugify } from '~/domain/slug'
import type { Lang } from '~/i18n/detect'
import { Combobox } from '~/ui/combobox'
import { CloseIcon, PlusIcon } from '~/ui/icons'
import { button, chip } from '~/ui/recipes'
import { toaster } from '~/ui/toast'
import { api } from './api'
import { checkWithSchema } from './editor'
import { isAuthError, saveFailureOf } from './errors'
import { type FieldStateProps, TextField } from './fields'
import { MarkdownEditor } from './markdown-editor'
import { MarkdownPreview } from './markdown-preview'
import { withoutUploadMarkers } from './markdown-text'
import { SortableList } from './sortable'
import { LoadError } from './states'

// ---- 保存を待たせる処理 ----------------------------------------------------------

/**
 * 保存ボタンを押せなくする処理（本文の画像のアップロード中、英語のタイトルからのスラッグの作成中）。
 * アップロード中に保存すると仮の記法が本文に残り（design-spec 6.7.4）、スラッグの作成中に保存すると古いスラッグで送る
 */
export function useBusy() {
  const [flags, setFlags] = useState<Record<string, boolean>>({})
  const set = useCallback((key: string, busy: boolean) => {
    setFlags((current) => (current[key] === busy ? current : { ...current, [key]: busy }))
  }, [])
  return { busy: Object.values(flags).some(Boolean), set }
}

// ---- 本文 ------------------------------------------------------------------

interface BodyEditorsProps {
  /** 欄の名前（「詳細本文」「本文」） */
  label: string
  /** 言語タブで選んでいる言語 */
  lang: Lang
  values: Record<Lang, string>
  onChange: (lang: Lang, value: string) => void
  fieldState: (lang: Lang) => FieldStateProps
  onUploadingChange: (lang: Lang, uploading: boolean) => void
}

const LANG_SUFFIX: Record<Lang, string> = { ja: '（日本語）', en: '（英語）' }

const previewFrame = css({
  minH: 'editor',
  p: 'inset',
  borderWidth: 'default',
  borderStyle: 'solid',
  borderColor: 'border.default',
  borderRadius: 'control',
})

/**
 * L5 の「Markdownエディタ ／ プレビュー」（design-spec 4.1）の中身。SplitEditLayout の editor と preview に渡す。
 * エディタは言語ごとに1つずつ作って選んでいない方を隠す（切り替えのたびに作り直すと元に戻す履歴が消える）
 */
export function bodyEditors({ label, lang, values, onChange, fieldState, onUploadingChange }: BodyEditorsProps): {
  editor: ReactNode
  preview: ReactNode
} {
  return {
    editor: (
      <>
        {(['ja', 'en'] as const).map((editorLang) => (
          <MarkdownEditor
            key={editorLang}
            label={`${label}${LANG_SUFFIX[editorLang]}`}
            value={values[editorLang]}
            onChange={(value) => onChange(editorLang, value)}
            lang={editorLang}
            hidden={editorLang !== lang}
            onUploadingChange={(uploading) => onUploadingChange(editorLang, uploading)}
            {...fieldState(editorLang)}
          />
        ))}
      </>
    ),
    preview: (
      <div className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}>
        <p className={css({ textStyle: 'label' })}>プレビュー{LANG_SUFFIX[lang]}</p>
        <div className={previewFrame}>
          <MarkdownPreview markdown={withoutUploadMarkers(values[lang])} lang={lang} />
        </div>
      </div>
    ),
  }
}

// ---- スラッグ --------------------------------------------------------------

type SlugType = (typeof SLUG_TYPES)[number]

/** 英語のタイトルを打っているあいだは API を呼ばず、打ち終わりを待つ */
const SLUG_CHECK_DELAY_MS = 400

export interface SlugFieldProps extends FieldStateProps {
  type: SlugType
  /** 編集中の項目の ID（新規作成は null）。重複の判定から自分を外す */
  excludeId: string | null
  name: string
  value: string
  onChange: (value: string) => void
  englishTitle: string
  /** 公開したことがあるか（design-spec 6.7.2 の判定）。あれば英語のタイトルに追従しない */
  everPublished: boolean
  /** 保存してあるスラッグ（新規作成は null）。公開したことがあるもので、これから変えたら警告する */
  savedSlug: string | null
  /** 追従中のスラッグを作っているあいだ true。そのあいだに保存すると古いスラッグで送るので、保存を待たせる */
  onPendingChange: (pending: boolean) => void
}

/**
 * 英語のタイトルからスラッグを作り、追従させる（design-spec 6.7.2）。
 * 追従するのは、公開したことがなく、今のスラッグが「今の英語のタイトルから作った値」と同じあいだ。
 * 「今の英語のタイトルから作った値」は API（同じ種類の中で重複しない値。SDD 5.10）で作り、`auto` に覚えておく
 */
function useSlugFollow({
  type,
  excludeId,
  englishTitle,
  value,
  onChange,
  everPublished,
  onPendingChange,
}: Pick<
  SlugFieldProps,
  'type' | 'excludeId' | 'englishTitle' | 'value' | 'onChange' | 'everPublished' | 'onPendingChange'
>) {
  /** 今の英語のタイトルから作った値。開いた直後で、まだ作っていなければ null */
  const [auto, setAuto] = useState<string | null>(null)
  const latest = useRef({ value, auto, everPublished, onChange, onPendingChange })
  latest.current = { value, auto, everPublished, onChange, onPendingChange }

  useEffect(() => {
    let active = true
    const title = englishTitle.trim()
    const following = (current: typeof latest.current) =>
      current.auto !== null && !current.everPublished && current.value === current.auto
    if (following(latest.current)) latest.current.onPendingChange(true)
    function apply(next: string) {
      if (!active) return
      const current = latest.current
      current.onPendingChange(false)
      // 開いた直後（auto が null）は、今のスラッグが追従中かを知るために覚えるだけで、書き換えない
      if (following(current) && current.value !== next) current.onChange(next)
      setAuto(next)
    }
    const timer = setTimeout(
      () => {
        // 英語のタイトルがない、または変換して空になるときは、スラッグを空にする（design-spec 6.7.2）
        if (title === '') {
          apply('')
          return
        }
        api.slugs
          .suggest({ type, title, excludeId: excludeId ?? undefined })
          .then((result) => apply(result.slug ?? ''))
          .catch((error: unknown) => {
            // 期限切れなどは API クライアントが画面を移す。それ以外で作れなかったときは、重複の連番を付けない
            // 手元の変換で追従を続ける。重複していれば、保存のときに SLUG_CONFLICT と候補が欄の下に出る
            if (isAuthError(error)) latest.current.onPendingChange(false)
            else apply(slugify(title) ?? '')
          })
      },
      latest.current.auto === null ? 0 : SLUG_CHECK_DELAY_MS,
    )
    return () => {
      active = false
      clearTimeout(timer)
      latest.current.onPendingChange(false)
    }
  }, [type, excludeId, englishTitle])

  return auto
}

type Availability = { slug: string; available: boolean | null }

/** 手で入れたスラッグの形式と重複を確かめる（design-spec 6.7.3。入っていれば） */
function useSlugProblem(type: SlugType, excludeId: string | null, value: string, savedSlug: string | null) {
  const [availability, setAvailability] = useState<Availability | null>(null)
  const parsed = optionalSlug.safeParse(value)
  const formatError = parsed.success ? null : (parsed.error.issues[0]?.message ?? null)
  const slug = parsed.success ? parsed.data : null

  useEffect(() => {
    // 空・形式の誤り・保存してある自分のスラッグは、重複を確かめない
    if (slug === null || slug === savedSlug) return
    let active = true
    const timer = setTimeout(() => {
      api.slugs
        .availability({ type, slug, excludeId: excludeId ?? undefined })
        .then((result) => {
          if (active) setAvailability({ slug, available: result.available })
        })
        .catch((error: unknown) => {
          // 確かめられなかったときは何も出さない。重複していれば、保存のときに SLUG_CONFLICT が欄の下に出る
          if (active && !isAuthError(error)) setAvailability({ slug, available: null })
        })
    }, SLUG_CHECK_DELAY_MS)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [type, excludeId, slug, savedSlug])

  if (formatError !== null) return formatError
  if (slug !== null && availability?.slug === slug && availability.available === false) {
    return slugConflictError.SLUG_CONFLICT.message
  }
  return null
}

/** 公開したことがあるものの、スラッグを変えたか（design-spec 6.7.2 の警告と保存のときの確認） */
export function slugChanged(everPublished: boolean, savedSlug: string | null, value: string): boolean {
  return everPublished && (savedSlug ?? '') !== value.trim()
}

export const SLUG_CHANGE_WARNING = '今のURLは見られなくなります'

export function SlugField({
  type,
  excludeId,
  name,
  value,
  onChange,
  englishTitle,
  everPublished,
  savedSlug,
  onPendingChange,
  errors = [],
  missing,
}: SlugFieldProps) {
  useSlugFollow({ type, excludeId, englishTitle, value, onChange, everPublished, onPendingChange })
  const problem = useSlugProblem(type, excludeId, value, savedSlug)
  const warn = slugChanged(everPublished, savedSlug, value)
  return (
    <TextField
      label="スラッグ"
      name={name}
      value={value}
      onChange={onChange}
      hint={
        warn ? (
          <span className={css({ color: 'warning.default' })}>{SLUG_CHANGE_WARNING}</span>
        ) : (
          '半角の英小文字・数字・ハイフン。英語のタイトルから自動で作ります'
        )
      }
      errors={problem === null || errors.includes(problem) ? errors : [...errors, problem]}
      missing={missing}
    />
  )
}

// ---- 使用技術（A5・A6） ------------------------------------------------------

/** フォームが持つ使用技術。表示名はチップに出すためだけに持ち、API には ID の並びだけを送る */
interface StackChoice {
  id: string
  displayName: string
}

export const STACKS_LIST_KEY = ['stacks', 'list']

const chipRow = css({ display: 'inline-flex', alignItems: 'center', gap: 'none' })
const chipRemove = button({ variant: 'ghost', shape: 'icon' })

export function StackPicker({
  value,
  onChange,
  errors = [],
}: {
  value: StackChoice[]
  onChange: (value: StackChoice[]) => void
  errors?: string[]
}) {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: STACKS_LIST_KEY, queryFn: () => api.stacks.list() })
  const [adding, setAdding] = useState(false)
  /** 作っている途中の技術の表示名。応答の前に同じ名前でもう一度作らないよう、登録済みの名前と同じに扱う */
  const [creatingNames, setCreatingNames] = useState<string[]>([])
  const creating = creatingNames.length > 0
  const addButton = useRef<HTMLButtonElement>(null)
  /** 検索の欄を閉じたあと、フォーカスを「+ 追加」へ戻すか */
  const refocus = useRef(false)
  // 作成の応答を待つあいだにチップを外したり並べ替えたりしても、その操作を応答で巻き戻さないよう、今の値を読む
  const valueRef = useRef(value)
  valueRef.current = value
  const stacks = query.data?.items ?? []
  const chosen = new Set(value.map((stack) => stack.id))
  const options = stacks
    .filter((stack) => !chosen.has(stack.id))
    .map((stack) => ({ value: stack.id, label: stack.displayName }))

  // 選ぶか Esc で検索の欄を閉じたら、フォーカスを「+ 追加」へ戻す（キーボードで続けて追加できるように）
  useEffect(() => {
    if (adding || !refocus.current) return
    refocus.current = false
    addButton.current?.focus()
  }, [adding])

  function close(moveFocus: boolean) {
    refocus.current = moveFocus
    setAdding(false)
  }

  function add(stack: StackChoice) {
    const current = valueRef.current
    if (!current.some((item) => item.id === stack.id)) onChange([...current, stack])
  }

  async function create(displayName: string) {
    setCreatingNames((names) => [...names, displayName])
    try {
      // 新しい技術として追加（design-spec 6.7.1）: トップには出さない設定で作り、識別名は API が表示名から作る
      const body = { displayName, showOnTop: false }
      const invalid = checkWithSchema(stackCreateInput, body)
      if (invalid) {
        toaster.create({
          title: invalid.fieldErrors.displayName?.[0] ?? '使用技術を追加できませんでした',
          type: 'error',
        })
        return
      }
      const created = await api.stacks.create(body)
      add({ id: created.id, displayName: created.displayName })
      void queryClient.invalidateQueries({ queryKey: ['stacks'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    } catch (error) {
      if (!isAuthError(error)) {
        const failure = saveFailureOf(error)
        const reason = failure.kind === 'invalid' ? failure.fieldErrors.displayName?.[0] : undefined
        toaster.create({ title: reason ?? '使用技術を追加できませんでした', type: 'error' })
      }
    } finally {
      setCreatingNames((names) => names.filter((name) => name !== displayName))
    }
  }

  return (
    <div className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}>
      <p className={css({ textStyle: 'label' })}>使用技術</p>
      <div className={css({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'inline' })}>
        {value.length > 0 && (
          <SortableList
            label="選んだ使用技術（並びがトップの行に出る順）"
            layout="wrap"
            items={value}
            getId={(stack) => stack.id}
            getLabel={(stack) => stack.displayName}
            onMove={(from, to) => {
              const next = [...value]
              const [moved] = next.splice(from, 1)
              if (moved !== undefined) next.splice(to, 0, moved)
              onChange(next)
            }}
            renderItem={(stack, _index, handle) => (
              <span className={cx(chip(), chipRow)}>
                {handle}
                {stack.displayName}
                <button
                  type="button"
                  aria-label={`「${stack.displayName}」を外す`}
                  onClick={() => onChange(value.filter((item) => item.id !== stack.id))}
                  className={chipRemove}
                >
                  <CloseIcon size="sm" />
                </button>
              </span>
            )}
          />
        )}
        {!adding && (
          <button
            ref={addButton}
            type="button"
            onClick={() => setAdding(true)}
            aria-busy={creating}
            className={button({ variant: 'outline' })}
          >
            <PlusIcon size="sm" />
            {creating ? '追加しています…' : '追加'}
          </button>
        )}
      </div>
      {adding &&
        (query.status === 'error' ? (
          <div className={css({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'inline' })}>
            <LoadError onRetry={() => query.refetch()} />
            <button type="button" onClick={() => close(true)} className={button({ variant: 'ghost' })}>
              閉じる
            </button>
          </div>
        ) : (
          <Combobox
            label="使用技術を検索"
            placeholder={query.status === 'pending' ? '読み込み中…' : '技術の名前'}
            options={options}
            // 登録済みの名前（選んだもの・一覧の読み直しの前に作ったもの・作っている途中のものを含む）と同じなら「新しい技術として追加」を
            // 出さない。同じ技術を二重に作らないため
            knownLabels={[...[...stacks, ...value].map((stack) => stack.displayName), ...creatingNames]}
            onSelect={(id) => {
              const stack = stacks.find((item) => item.id === id)
              if (stack) add({ id: stack.id, displayName: stack.displayName })
            }}
            onCreate={(text) => void create(text)}
            createLabel={(text) => `「${text}」を新しい技術として追加`}
            emptyText="該当する技術がありません（選んだ技術は出しません）"
            autoFocus
            onClose={({ moveFocus }) => close(moveFocus)}
          />
        ))}
      {errors.map((message) => (
        <p key={message} className={css({ textStyle: 'body-sm', color: 'danger.default' })}>
          {message}
        </p>
      ))}
    </div>
  )
}

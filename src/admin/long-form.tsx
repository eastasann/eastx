/**
 * L5 の編集ビュー（A5・A6・A8・A9）で共通の部品（design-spec 6.7.1・6.7.2）:
 * - 表示の切り替え（書く｜並べる｜日英｜プレビュー）と言語タブ、設定パネル、誤りの欄を見えるようにする処理
 * - 本文のエディタとプレビュー（「並べる」ではプレビューがエディタのスクロールに追従する）
 * - 公開状態のボタン
 * - スラッグの欄（英語のタイトルからの自動の生成と追従、形式と重複の確かめ、公開したことがあるものの変更の警告）
 * - 使用技術の選択（A5・A6。検索して続けて選ぶ、新しい技術として追加、並べ替え）
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { css } from 'styled-system/css'
import { optionalSlug, slugConflictError } from '~/api/contract/common'
import type { SLUG_TYPES } from '~/api/contract/misc'
import { stackCreateInput } from '~/api/contract/stacks'
import type { Languages } from '~/domain/languages'
import type { Status } from '~/domain/publishing'
import { slugify } from '~/domain/slug'
import type { Lang } from '~/i18n/detect'
import { Combobox } from '~/ui/combobox'
import { CloseIcon, PlusIcon } from '~/ui/icons'
import { FallbackImage } from '~/ui/image'
import { button } from '~/ui/recipes'
import { toaster } from '~/ui/toast'
import { MEDIA, useMediaQuery } from '~/ui/use-media-query'
import { api } from './api'
import {
  checkWithSchema,
  LanguageLabel,
  LanguageTabs,
  PublishActions,
  type SaveAction,
  SaveStatus,
  StatusBadge,
  type usePublishFlow,
  useReportBusy,
} from './editor'
import { SLUG_CHANGE_WARNING } from './editor-rules'
import { isAuthError, saveFailureOf } from './errors'
import { type FieldStateProps, fieldLabel, TextField } from './fields'
import { LocalizedColumn, SplitEditLayout } from './layouts'
import { MarkdownEditor } from './markdown-editor'
import { MarkdownPreview } from './markdown-preview'
import { withoutUploadMarkers } from './markdown-text'
import { SortableList } from './sortable'
import { LoadError } from './states'
import {
  EDITOR_VIEW_KEY,
  EDITOR_VIEWS,
  type EditorView,
  effectiveEditorView,
  readStoredView,
  writeStoredView,
} from './view-preference'

// ---- 表示の切り替えと、誤りの欄を見えるようにする処理 -------------------------------------

/**
 * 表示の切り替え・言語タブ・設定の引き出しの状態（design-spec 6.7 の「表示の切り替え」「誤りの欄への移動」）。
 * 表示の記憶を書くのは持ち主が切り替えを押したときだけ（誤りの欄へ移るための切り替えでは書かない）。
 * 「日英」のあいだは言語タブを出さず lang を変えないので、「日英」から戻ると前に選んでいた言語タブに戻る
 */
export function useLongFormView(settingsKeys: readonly string[]) {
  const isMobile = useMediaQuery(MEDIA.mobile)
  const isWide = useMediaQuery(MEDIA.wide)
  const [chosen, setChosen] = useState<EditorView>(() => readStoredView(EDITOR_VIEW_KEY, EDITOR_VIEWS, 'split'))
  const [lang, setLang] = useState<Lang>('ja')
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** 誤りの欄へ移るために引き出しを開いたとき、フォーカスを移す欄 */
  const settingsFocus = useRef<string | null>(null)
  const view = effectiveEditorView(chosen, isMobile)

  return {
    view,
    lang,
    setLang,
    settingsOpen,
    setSettingsOpen(open: boolean) {
      if (!open) settingsFocus.current = null
      setSettingsOpen(open)
    },
    /** 引き出しを開いたときにフォーカスを移す要素（誤りの欄へ移るときだけ。ほかは引き出しの既定） */
    settingsInitialFocus(): HTMLElement | null {
      const key = settingsFocus.current
      if (key === null) return null
      return document.querySelector<HTMLElement>(
        `[data-field="${CSS.escape(key)}"] :is(input:not([type=file]), textarea, button)`,
      )
    },
    /** 持ち主が表示を切り替えた */
    chooseView(next: EditorView) {
      setChosen(next)
      writeStoredView(EDITOR_VIEW_KEY, next)
    },
    /** 誤りの欄を見えるようにする。描き直しを待つ必要があれば true */
    reveal(key: string): boolean {
      if (settingsKeys.some((name) => key === name || key.startsWith(`${name}.`))) {
        if (isWide || settingsOpen) return false
        settingsFocus.current = key
        setSettingsOpen(true)
        return true
      }
      let changed = false
      const keyLang = key.startsWith('ja.') ? 'ja' : key.startsWith('en.') ? 'en' : null
      if (keyLang !== null && view !== 'bilingual' && keyLang !== lang) {
        setLang(keyLang)
        changed = true
      }
      // 本文の誤りは、エディタを隠している「プレビュー」から「書く」に移って見せる
      if (key.endsWith('.body') && view === 'preview') {
        setChosen('write')
        changed = true
      }
      return changed
    },
  }
}

// ---- 本文 ------------------------------------------------------------------

const LANG_SUFFIX: Record<Lang, string> = { ja: '（日本語）', en: '（英語）' }

/**
 * プレビューの枠。「並べる」では、エディタの見えている先頭の行に最も近いブロックへスクロールする
 * （エディタ → プレビューの一方向。両方向にすると互いに動かし合って揺れる）
 */
function PreviewPane({ markdown, lang, topLine }: { markdown: string; lang: Lang; topLine: number | null }) {
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = container.current
    if (element === null || topLine === null) return
    const line = topLine
    function sync(scroller: HTMLDivElement) {
      let target: HTMLElement | null = null
      for (const block of scroller.querySelectorAll<HTMLElement>('[data-source-line]')) {
        if (Number(block.dataset.sourceLine) > line) break
        target = block
      }
      const top =
        target === null
          ? 0
          : target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
      scroller.scrollTo({ top })
    }
    sync(element)
    // プレビューは打ち終わりを待ってから描き直すので、描き直したあとにも合わせ直す
    const observer = new MutationObserver(() => sync(element))
    observer.observe(element, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [topLine])
  return (
    <>
      <p className={fieldLabel}>プレビュー{LANG_SUFFIX[lang]}</p>
      <div
        ref={container}
        className={css({
          flex: '1',
          minH: 'editor',
          p: 'inset',
          overflowY: 'auto',
          borderWidth: 'default',
          borderStyle: 'solid',
          borderColor: 'border.default',
          borderRadius: 'control',
        })}
      >
        <MarkdownPreview markdown={withoutUploadMarkers(markdown)} lang={lang} sourceLines />
      </div>
    </>
  )
}

// ---- L5 の編集ビュー ---------------------------------------------------------

export interface LongFormEditViewProps {
  back: ReactNode
  title: string
  status: Status | null
  saveStatus: { text: string; tone: 'muted' | 'changed' }
  /** ボタンを押せない理由 */
  reason: string | null
  pending: SaveAction | 'delete' | null
  layout: ReturnType<typeof useLongFormView>
  languages: Languages
  problems: Record<Lang, boolean>
  /** 復元の提案・公開に足りない項目 */
  notices: ReactNode
  /** 言語ごとの欄（タイトル・概要） */
  localized: (lang: Lang) => ReactNode
  body: {
    /** 欄の名前（「詳細本文」「本文」） */
    label: string
    values: Record<Lang, string>
    onChange: (lang: Lang, value: string) => void
    fieldState: (lang: Lang) => FieldStateProps
  }
  settings: ReactNode
  settingsInvalid: boolean
  actions: ReturnType<typeof usePublishFlow>
  children?: ReactNode
}

/** L5 の編集ビューの骨組み（作品・プロジェクト・ブログ・コーディング記録で共通） */
export function LongFormEditView({
  back,
  title,
  status,
  saveStatus,
  reason,
  pending,
  layout,
  languages,
  problems,
  notices,
  localized,
  body,
  settings,
  settingsInvalid,
  actions,
  children,
}: LongFormEditViewProps) {
  // どの言語のエディタの行かも覚え、言語タブを替えたら、その言語のエディタがスクロールするまで追従しない
  const [scrolled, setScrolled] = useState<{ lang: Lang; line: number } | null>(null)
  const { view, lang } = layout
  const topLine = view === 'split' && scrolled?.lang === lang ? scrolled.line : null
  return (
    <SplitEditLayout
      back={back}
      title={title}
      status={
        <>
          <StatusBadge status={status} />
          <SaveStatus {...saveStatus} />
        </>
      }
      actions={
        <PublishActions
          status={status}
          pending={pending}
          reason={reason}
          onSave={actions.requestSave}
          onUnpublish={actions.openUnpublish}
          onDelete={actions.openDelete}
        />
      }
      view={view}
      onViewChange={layout.chooseView}
      lang={lang}
      tabs={
        <LanguageTabs
          value={lang}
          onValueChange={layout.setLang}
          languages={languages}
          problems={problems}
          panels={{ ja: localized('ja'), en: localized('en') }}
        />
      }
      localized={(columnLang) => (
        <LocalizedColumn
          heading={<LanguageLabel lang={columnLang} languages={languages} problem={problems[columnLang]} />}
        >
          {localized(columnLang)}
        </LocalizedColumn>
      )}
      editors={{
        ja: (
          <MarkdownEditor
            label={`${body.label}${LANG_SUFFIX.ja}`}
            name="ja.body"
            value={body.values.ja}
            onChange={(value) => body.onChange('ja', value)}
            lang="ja"
            onTopLineChange={(line) => setScrolled({ lang: 'ja', line })}
            {...body.fieldState('ja')}
          />
        ),
        en: (
          <MarkdownEditor
            label={`${body.label}${LANG_SUFFIX.en}`}
            name="en.body"
            value={body.values.en}
            onChange={(value) => body.onChange('en', value)}
            lang="en"
            onTopLineChange={(line) => setScrolled({ lang: 'en', line })}
            {...body.fieldState('en')}
          />
        ),
      }}
      preview={<PreviewPane markdown={body.values[lang]} lang={lang} topLine={topLine} />}
      notices={notices}
      settings={settings}
      settingsInvalid={settingsInvalid}
      settingsOpen={layout.settingsOpen}
      onSettingsOpenChange={layout.setSettingsOpen}
      settingsInitialFocus={layout.settingsInitialFocus}
    >
      {actions.dialogs}
      {children}
    </SplitEditLayout>
  )
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
}: Pick<SlugFieldProps, 'type' | 'excludeId' | 'englishTitle' | 'value' | 'onChange' | 'everPublished'>) {
  // 追従中のスラッグを作っているあいだは、保存を待たせる（古いスラッグで送らないため）
  const onPendingChange = useReportBusy('slug')
  /** 今の英語のタイトルから作った値。開いた直後で、まだ作っていなければ null */
  const [auto, setAuto] = useState<string | null>(null)
  const latest = useRef({ value, auto, everPublished, onChange, onPendingChange })
  latest.current = { value, auto, everPublished, onChange, onPendingChange }

  useEffect(() => {
    let active = true
    const title = englishTitle.trim()
    const following = (current: typeof latest.current) =>
      current.auto !== null && !current.everPublished && current.value === current.auto
    function apply(next: string) {
      if (!active) return
      const current = latest.current
      current.onPendingChange(false)
      // 開いた直後（auto が null）は、今のスラッグが追従中かを知るために覚えるだけで、書き換えない
      if (following(current) && current.value !== next) current.onChange(next)
      setAuto(next)
    }
    // 英語のタイトルがなければ、作る値は空と決まっている（design-spec 6.7.2）。API を待たずに入れ、保存も待たせない
    if (title === '') {
      apply('')
      return () => {
        active = false
      }
    }
    if (following(latest.current)) latest.current.onPendingChange(true)
    const timer = setTimeout(
      () => {
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

export function SlugField({
  type,
  excludeId,
  name,
  value,
  onChange,
  englishTitle,
  everPublished,
  savedSlug,
  errors = [],
  missing,
}: SlugFieldProps) {
  useSlugFollow({ type, excludeId, englishTitle, value, onChange, everPublished })
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

/** フォームが持つ使用技術。表示名は並びに出すためだけに持ち、API には ID の並びだけを送る */
interface StackChoice {
  id: string
  displayName: string
}

export const STACKS_LIST_KEY = ['stacks', 'list']

const stackItem = css({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'inline-tight',
  textStyle: 'ui',
  color: 'text.default',
})
const stackRemove = button({ variant: 'ghost', shape: 'compact' })
const stackIcon = css({ w: 'icon-sm', h: 'icon-sm', flexShrink: 0 })

/**
 * 使用技術の小さなアイコン。表示名が隣にあるので飾り（代替テキストは空）。検索の候補では、アイコンの無い技術も
 * 名前の位置が揃うよう、同じ幅を空けておく
 */
function StackIcon({ iconUrl }: { iconUrl: string | null }) {
  if (iconUrl === null) return <span aria-hidden="true" className={stackIcon} />
  return <FallbackImage src={iconUrl} alt="" className={stackIcon} fit="contain" />
}

/**
 * 使用技術の欄（design-spec 6.7.1）。選んだ技術は「つまみ・アイコン・表示名・×」を横に並べて折り返す。
 * 検索の欄は選んでも閉じず、選んだ技術には ✓ を付け、もう一度選ぶと外す。Esc か欄の外を押すと閉じる
 */
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
  // 作成の応答を待つあいだに外したり並べ替えたりしても、その操作を応答で巻き戻さないよう、今の値を読む
  const valueRef = useRef(value)
  valueRef.current = value
  const stacks = query.data?.items ?? []
  const iconOf = new Map(stacks.map((stack) => [stack.id, stack.iconUrl]))
  const options = stacks.map((stack) => ({
    value: stack.id,
    label: stack.displayName,
    icon: <StackIcon iconUrl={stack.iconUrl} />,
  }))

  // Esc で検索の欄を閉じたら、フォーカスを「+ 追加」へ戻す（キーボードで続けて操作できるように）
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

  function toggle(id: string) {
    const current = valueRef.current
    if (current.some((item) => item.id === id)) {
      onChange(current.filter((item) => item.id !== id))
      return
    }
    const stack = stacks.find((item) => item.id === id)
    if (stack) add({ id: stack.id, displayName: stack.displayName })
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
    <div data-field="stackIds" className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}>
      <p className={fieldLabel}>使用技術</p>
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
          renderItem={(stack, _index, handle) => {
            const icon = iconOf.get(stack.id) ?? null
            return (
              <span className={stackItem}>
                {handle}
                {/* アイコンが無い技術はアイコンを出さずに詰める（design-spec 4.4） */}
                {icon !== null && <StackIcon iconUrl={icon} />}
                {stack.displayName}
                <button
                  type="button"
                  aria-label={`「${stack.displayName}」を外す`}
                  onClick={() => onChange(valueRef.current.filter((item) => item.id !== stack.id))}
                  className={stackRemove}
                >
                  <CloseIcon size="sm" />
                </button>
              </span>
            )
          }}
        />
      )}
      {adding ? (
        query.status === 'error' ? (
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
            selectedValues={value.map((stack) => stack.id)}
            keepOpen
            // 登録済みの名前（選んだもの・一覧の読み直しの前に作ったもの・作っている途中のものを含む）と同じなら「新しい技術として追加」を
            // 出さない。同じ技術を二重に作らないため
            knownLabels={[...[...stacks, ...value].map((stack) => stack.displayName), ...creatingNames]}
            onSelect={toggle}
            onCreate={(text) => void create(text)}
            createLabel={(text) => `「${text}」を新しい技術として追加`}
            emptyText="該当する技術がありません"
            autoFocus
            onClose={({ moveFocus }) => close(moveFocus)}
          />
        )
      ) : (
        <button
          ref={addButton}
          type="button"
          onClick={() => setAdding(true)}
          aria-busy={creating}
          className={css(button.raw({ variant: 'outline' }), { alignSelf: 'flex-start' })}
        >
          <PlusIcon size="sm" />
          {creating ? '追加しています…' : '追加'}
        </button>
      )}
      {errors.map((message) => (
        <p key={message} className={css({ textStyle: 'body-sm', color: 'danger.default' })}>
          {message}
        </p>
      ))}
    </div>
  )
}

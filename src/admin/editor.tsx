/**
 * 編集ビュー（L5・L6）の共通の仕組み（design-spec 6.4・6.7、SDD 8章）:
 * - フォームの状態と、最後に保存した（読み込んだ）内容。保存に成功したあとの入れ替え
 * - 保存していない変更の検出と、画面を移るときの確認
 * - 自動退避（localStorage）と、開いたときの復元の提案
 * - 保存ボタンの状態・押せない理由、Cmd/Ctrl+S、入力チェック・公開に足りない項目・重複の表示と、最初の誤りの欄への移動
 * - 言語タブの印、操作バーのボタンと状態の札、読み込み中・取得に失敗・存在しない ID の表示
 *
 * フォームの状態は画面ごとの TanStack Form が持ち、ここは値の比較と出し方だけを受け持つ（ADR-008）
 */
import { useForm, useStore } from '@tanstack/react-form'
import { useBlocker } from '@tanstack/react-router'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { css, cva } from 'styled-system/css'
import type { z } from 'zod'
import type { Languages } from '~/domain/languages'
import type { MissingField, Status, Transition } from '~/domain/publishing'
import type { Lang } from '~/i18n/detect'
import { formatAdminTime } from '~/i18n/format'
import { ArrowLeftIcon, TrashIcon } from '~/ui/icons'
import { button, label } from '~/ui/recipes'
import { Tabs } from '~/ui/tabs'
import { toaster } from '~/ui/toast'
import { Tooltip } from '~/ui/tooltip'
import { onBeforeLoginRedirect } from './api'
import { AutoBackup, type BackupOffer, type BackupType, backupKey, browserStorage, sameValues } from './backup'
import { ConfirmDialog } from './confirm-dialog'
import {
  blockedReason,
  firstErrorField,
  isSaveShortcut,
  problemsNotice,
  type SaveAction,
  type SaveKind,
  SLUG_CHANGE_WARNING,
  saveStatusText,
  shortcutAction,
} from './editor-rules'
import { type FieldErrors, fieldKey, issuesToErrors, missingKey, saveFailureOf } from './errors'
import { rebaseValues } from './form-values'
import { NOTICES, STATUS_LABELS } from './labels'
import { LocalizedColumn, WideOnlyText } from './layouts'
import { AdminLink } from './link'
import { LoadError, Skeleton } from './states'
import { FORM_VIEW_KEY, FORM_VIEWS, useStoredView } from './view-preference'

export type { SaveAction } from './editor-rules'

/**
 * 期限切れの通知を読めるだけの時間、A1 へ移るのを待つ（design-spec 6.4 の「移る前に…と出す」）。
 * A1 へはページを読み込み直して移る（src/admin/api.ts）ので、移ったあとには通知を出せない
 */
const SESSION_EXPIRED_NOTICE_MS = 2500

// ---- 保存を待たせる処理 ----------------------------------------------------------

/**
 * 保存ボタンと Cmd/Ctrl+S を止める処理（画像のアップロード中、英語のタイトルからのスラッグの作成中）。
 * アップロード中に保存すると仮の記法や古い画像が残り（design-spec 6.7.4）、スラッグの作成中に保存すると古いスラッグで送る。
 * キーの頭（`upload`・`slug`）で、押せない理由の文言を分ける（editor-rules.ts の blockedReason）
 */
function useBusy() {
  const [flags, setFlags] = useState<Record<string, boolean>>({})
  const set = useCallback((key: string, busy: boolean) => {
    setFlags((current) => (current[key] === busy ? current : { ...current, [key]: busy }))
  }, [])
  const keys = Object.keys(flags).filter((key) => flags[key])
  return { busy: keys.length > 0, keys, set }
}

const BusyContext = createContext<(key: string, busy: boolean) => void>(() => {})

/**
 * 編集ビューの中の部品（画像欄・本文のエディタ・スラッグの欄）が、保存を待たせていることを知らせる。
 * アップロードは部品が描き直されても（設定パネルが幅 1280px をまたいで引き出しと行き来する）続くので、`upload` は
 * 部品が消えても待たせたままにし、終わったときの知らせで解く。スラッグは描き直すと作り直すので、消えたら解く
 */
export function useReportBusy(kind: 'upload' | 'slug'): (busy: boolean) => void {
  const set = useContext(BusyContext)
  const key = `${kind}-${useId()}`
  useEffect(() => {
    if (kind === 'slug') return () => set(key, false)
  }, [kind, set, key])
  return useCallback((busy: boolean) => set(key, busy), [set, key])
}

// ---- 自動退避と移動の確認 --------------------------------------------------------

interface EditSessionOptions<V> {
  values: V
  /** 確認のときに読む今の値。描画の途中の値ではなく、フォームの最新の状態を返す */
  getValues: () => V
  /** 最後に保存した（読み込んだ）値。これと違えば「保存していない変更」 */
  baseline: V
  backupKey: string
  /** 退避の中身がこのフォームの形か */
  isValues: (value: unknown) => value is V
  /** 比べるときの形（比較に関係ない値を外す）。省くと値そのもの */
  comparable?: (values: V) => unknown
  /** サーバーの最終保存（新規作成は null）。退避より新しければ復元の提案に添える */
  serverUpdatedAt: string | null
  /** 退避の内容をフォームに戻す（保存していない変更として） */
  restore: (values: V) => void
}

function useEditSession<V>({
  values,
  getValues,
  baseline,
  backupKey: key,
  isValues,
  comparable,
  serverUpdatedAt,
  restore,
}: EditSessionOptions<V>) {
  const [backup] = useState(() => new AutoBackup<V>({ storage: browserStorage(), key, baseline, comparable }))
  const [offer, setOffer] = useState<BackupOffer<V> | null>(() => backup.takeOffer(isValues, serverUpdatedAt))
  const getValuesRef = useRef(getValues)
  getValuesRef.current = getValues
  /** 自分で画面を移すとき（保存後の URL の置き換え・削除・期限切れ）は確認しない */
  const leavingRef = useRef(false)
  /** 保存の応答が返る前に別の画面へ移っていたら、保存後の移動（URL の置き換え）をしない */
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      backup.dispose()
    }
  }, [backup])

  // 値が変わったときだけ退避の規則に知らせる。開いた直後（まだ何も入力していない）は何もしない
  const lastValues = useRef(values)
  useEffect(() => {
    if (sameValues(values, lastValues.current)) return
    lastValues.current = values
    backup.changed(values)
  }, [backup, values])

  useEffect(
    () =>
      onBeforeLoginRedirect(async () => {
        const current = getValuesRef.current()
        if (backup.isClean(current)) return
        leavingRef.current = true
        backup.flush(current)
        toaster.create({ title: NOTICES.sessionExpired, type: 'warning' })
        await new Promise((resolve) => setTimeout(resolve, SESSION_EXPIRED_NOTICE_MS))
      }),
    [backup],
  )

  const isDirty = () => !backup.isClean(getValuesRef.current())

  const blocker = useBlocker({
    shouldBlockFn: () => !leavingRef.current && isDirty(),
    enableBeforeUnload: () => !leavingRef.current && isDirty(),
    withResolver: true,
  })

  return {
    /** 復元を提案している退避（design-spec 6.4） */
    offer,
    restoreOffer() {
      if (offer === null) return
      restore(offer.values)
      backup.restored(offer.values)
      setOffer(null)
    },
    discardOffer() {
      backup.discarded(getValuesRef.current())
      setOffer(null)
    },
    /** 保存に成功した。新規作成の初めての保存では key が `{id}` に変わる。復元の提案は答えるまで出し続ける */
    saved(next: { key: string; baseline: V; values: V }) {
      backup.saved(next)
    },
    /** 削除した */
    clear() {
      backup.clear()
      setOffer(null)
    },
    /** 確認を出さずに画面を移す。すでにこの編集ビューを離れていれば移さない */
    async leave(navigate: () => Promise<void>) {
      if (!mountedRef.current) return
      leavingRef.current = true
      try {
        await navigate()
      } finally {
        leavingRef.current = false
      }
    },
    /** 移動の確認が開いている */
    confirming: blocker.status === 'blocked',
    leaveDialog: (
      <ConfirmDialog
        open={blocker.status === 'blocked'}
        title="移動の確認"
        message="保存していない変更があります。移動しますか？"
        confirmLabel="移動する"
        onConfirm={() => {
          backup.clear()
          blocker.proceed?.()
        }}
        onCancel={() => blocker.reset?.()}
      />
    ),
  }
}

// ---- 保存の状態 ---------------------------------------------------------------

const SAVE_NOTICES: Record<SaveAction, string> = {
  save: NOTICES.saved,
  saveDraft: NOTICES.saved,
  publish: NOTICES.published,
  update: NOTICES.updated,
  unpublish: NOTICES.unpublished,
}

/** 共通のスキーマ（コントラクトの入力）で、Standard Schema の口から確かめる。Zod の検証は同期で終わる */
export function checkWithSchema(schema: z.ZodType, value: unknown): ReturnType<typeof issuesToErrors> | null {
  const result = schema['~standard'].validate(value)
  if (result instanceof Promise) throw new Error('非同期のスキーマは使わない')
  return result.issues ? issuesToErrors(result.issues) : null
}

export interface SaveRequest<O> {
  /** 送る前の入力チェック（ADR-008: API と同じスキーマ）。null なら通す */
  check: () => ReturnType<typeof issuesToErrors> | null
  request: () => Promise<O>
  onSuccess: (output: O) => Promise<void> | void
}

/**
 * 保存ボタンの状態（design-spec 6.7.4）と、失敗の出し方（SDD 8章）。
 * 誤りがあれば `onProblems` に誤りの欄のキー（fieldErrors のキーと公開に足りない項目のキー）を渡す
 */
function useSaveState(onProblems: (keys: string[], count: number) => void) {
  const [pending, setPending] = useState<SaveAction | 'delete' | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [missing, setMissing] = useState<MissingField[]>([])

  function clear() {
    setFieldErrors({})
    setFormErrors([])
    setMissing([])
  }

  function report(errors: FieldErrors, messages: string[], missingFields: MissingField[]) {
    setFieldErrors(errors)
    setFormErrors(messages)
    setMissing(missingFields)
    const keys = [...Object.keys(errors), ...missingFields.map(missingKey)]
    onProblems(keys, new Set(keys).size + messages.length)
  }

  async function run<O>(action: SaveAction, { check, request, onSuccess }: SaveRequest<O>): Promise<void> {
    clear()
    const invalid = check()
    if (invalid) {
      report(invalid.fieldErrors, invalid.formErrors, [])
      return
    }
    setPending(action)
    try {
      const output = await request()
      await onSuccess(output)
      toaster.create({ title: SAVE_NOTICES[action], type: 'success' })
    } catch (error) {
      const failure = saveFailureOf(error)
      switch (failure.kind) {
        case 'invalid':
          report(failure.fieldErrors, failure.formErrors, [])
          break
        case 'missing':
          report({}, [], failure.missing)
          break
        case 'conflict':
          report({ [failure.field]: [`${failure.message}（候補: ${failure.suggestion}）`] }, [], [])
          break
        case 'auth':
          break
        default:
          toaster.create({ title: NOTICES.saveFailed, type: 'error' })
      }
    } finally {
      setPending(null)
    }
  }

  const missingKeys = new Set(missing.map(missingKey))
  const problemKeys = [...Object.keys(fieldErrors), ...missingKeys]
  return {
    pending,
    setPending,
    run,
    missing,
    formErrors,
    /** 欄の名前（TanStack Form の名前でも、fieldErrors のキーでもよい）ごとの表示 */
    fieldState(name: string) {
      const key = fieldKey(name)
      return { errors: fieldErrors[key], missing: missingKeys.has(key) }
    },
    /** その言語の欄に、理由か足りない項目があるか（言語タブ・言語の見出しの印） */
    hasProblemIn(lang: Lang) {
      return problemKeys.some((key) => key.startsWith(`${lang}.`))
    },
    /** 指定した欄のどれかに誤りがあるか（設定の引き出しを開くボタンの印） */
    hasProblemInAny(keys: readonly string[]) {
      return problemKeys.some((key) => keys.some((name) => key === name || key.startsWith(`${name}.`)))
    },
  }
}

/** 欄へスクロールしてフォーカスを移す。欄は FieldShell などが `data-field` に欄のキーを持つ */
function focusField(key: string): boolean {
  const container = document.querySelector<HTMLElement>(`[data-field="${CSS.escape(key)}"]`)
  if (container === null) return false
  const target =
    container.querySelector<HTMLElement>('input:not([type=file]), textarea, [contenteditable=true], button') ??
    container
  target.scrollIntoView({ block: 'center' })
  target.focus({ preventScroll: true })
  return true
}

// ---- 編集ビューの状態 ------------------------------------------------------------

export interface EditorOptions<V, Item> {
  initial: Item | null
  toForm: (item: Item | null) => V
  backupType: BackupType
  isValues: (value: unknown) => value is V
  comparable?: (values: V) => unknown
  idOf: (item: Item) => string
  updatedAtOf: (item: Item) => string
  saveKind: SaveKind
  /** 公開状態（状態を持たないものは省く） */
  statusOf?: (item: Item) => Status
  /** 欄のキーの並び（design-spec 6.7.3の順） */
  fieldOrder: readonly string[]
  /**
   * 誤りの欄を見えるようにする（隠れた言語タブへ切り替える・設定の引き出しを開く）。
   * 戻り値が true なら、描き直しを待ってからフォーカスを移す
   */
  reveal?: (key: string) => boolean
}

/**
 * 編集ビュー（L5・L6）のフォームと保存の状態。画面ごとの部品は、送る中身（API の呼び分け）と欄の描画だけを持つ
 */
export function useEditor<V, Item>({
  initial,
  toForm,
  backupType,
  isValues,
  comparable,
  idOf,
  updatedAtOf,
  saveKind,
  statusOf,
  fieldOrder,
  reveal,
}: EditorOptions<V, Item>) {
  const [saved, setSaved] = useState(initial)
  const [baseline, setBaseline] = useState(() => toForm(initial))
  // useForm の既定値は、最後に reset に渡した値と同じに保つ。違うと、TanStack Form は描画のたびに既定値が
  // 変わったとみなし、触っていないフォームの値を既定値で上書きする（保存を待つあいだの入力が消える）
  const [formDefaults, setFormDefaults] = useState(baseline)
  const form = useForm({ defaultValues: formDefaults })
  const values = useStore(form.store, (state) => state.values)
  const busy = useBusy()
  const revealRef = useRef(reveal)
  revealRef.current = reveal

  const save = useSaveState((keys, count) => {
    if (count > 0) toaster.create({ title: problemsNotice(count), type: 'error' })
    const first = firstErrorField(fieldOrder, keys)
    if (first === null) return
    const waits = revealRef.current?.(first) ?? false
    // タブの切り替え・引き出しを開くのは次の描画で反映されるので、描き終わってから移す
    if (waits) requestAnimationFrame(() => requestAnimationFrame(() => focusField(first)))
    else focusField(first)
  })

  const session = useEditSession({
    values,
    getValues: () => form.state.values,
    baseline,
    backupKey: backupKey(backupType, saved === null ? null : idOf(saved)),
    isValues,
    comparable,
    serverUpdatedAt: saved === null ? null : updatedAtOf(saved),
    restore: (restored) => form.reset(restored, { keepDefaultValues: true }),
  })

  const compare = comparable ?? ((input: V) => input)
  const dirty = !sameValues(compare(values), compare(baseline))
  const status = saved !== null && statusOf ? statusOf(saved) : null
  // 削除中は押したボタンが「削除中…」を出すので、理由は出さない（design-spec 6.7.4 の理由は保存のものだけ）
  const reason = save.pending === 'delete' ? null : blockedReason(save.pending !== null, busy.keys)

  return {
    form,
    values,
    saved,
    baseline,
    save,
    busy,
    session,
    dirty,
    status,
    /** ボタンを押せない理由（押せるときは null） */
    reason,
    /**
     * 保存に成功した内容を入れる。保存を送ってから応答が返るまでに書き換えた欄は今の値のまま残す（form-values.ts）。
     * 新規作成の初めての保存なら true（呼び出し側が URL を置き換える）
     */
    applySaved(output: Item, sent: V): boolean {
      const next = toForm(output)
      const created = saved === null
      setSaved(output)
      setBaseline(next)
      const merged = rebaseValues(sent, form.state.values, next)
      setFormDefaults(merged)
      form.reset(merged)
      session.saved({ key: backupKey(backupType, idOf(output)), baseline: next, values: merged })
      return created
    },
    /** 操作バーの保存の状態（design-spec 6.7.4） */
    saveStatus: saveStatusText({
      isNew: saved === null,
      dirty,
      saving: save.pending !== null && save.pending !== 'delete',
      updatedAt: saved === null ? null : updatedAtOf(saved),
    }),
    /** Cmd/Ctrl+S で行う保存（送らないときは null） */
    shortcut(confirming: boolean): SaveAction | null {
      return shortcutAction({
        kind: saveKind,
        status,
        dirty: !sameValues(compare(form.state.values), compare(baseline)),
        blocked: reason !== null,
        confirming: confirming || session.confirming,
      })
    },
    /** 画像欄・本文のエディタが保存を待たせるのを受ける */
    BusyProvider: useMemo(
      () =>
        function BusyProvider({ children }: { children: ReactNode }) {
          return <BusyContext.Provider value={busy.set}>{children}</BusyContext.Provider>
        },
      [busy.set],
    ),
  }
}

/**
 * Cmd/Ctrl+S（design-spec 6.7.1）。編集ビューの最上位（window）で受け、ブラウザの「ページを保存」を止めてから、
 * `decide` が返す保存をする。CodeMirror の中の打鍵も届く（エディタの keymap は既定の動きを止めるだけ）
 */
export function useSaveShortcut(decide: () => SaveAction | null, onSave: (action: SaveAction) => void) {
  const latest = useRef({ decide, onSave })
  latest.current = { decide, onSave }
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isSaveShortcut(event)) return
      event.preventDefault()
      const action = latest.current.decide()
      if (action !== null) latest.current.onSave(action)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

// ---- 公開状態のボタンと確認ダイアログ ----------------------------------------------------

type Confirm = { type: 'unpublish' } | { type: 'delete' } | { type: 'slug'; action: Transition }

export interface PublishFlowOptions {
  title: string
  pending: SaveAction | 'delete' | null
  /** 公開したことがあるもののスラッグを変えたか（保存の前に確かめる。design-spec 6.7.2） */
  slugChanged: () => boolean
  submit: (action: Transition) => Promise<void>
  remove: () => Promise<void>
  /** Cmd/Ctrl+S で行う保存（editor.tsx の useEditor の shortcut） */
  shortcut: (confirming: boolean) => SaveAction | null
}

/**
 * 公開状態を持つ編集ビューの保存の流れ（design-spec 6.7.1）。確認ダイアログ（非公開に戻す・スラッグの変更・削除）と、
 * Cmd/Ctrl+S（確認ダイアログが開いているあいだは保存しない）
 */
export function usePublishFlow({ title, pending, slugChanged, submit, remove, shortcut }: PublishFlowOptions) {
  const [confirm, setConfirm] = useState<Confirm | null>(null)

  const requestSave = useCallback(
    (action: Transition) => {
      if (slugChanged()) {
        setConfirm({ type: 'slug', action })
        return
      }
      setConfirm(null)
      void submit(action)
    },
    [slugChanged, submit],
  )

  useSaveShortcut(
    () => shortcut(confirm !== null),
    (action) => {
      if (action !== 'save') requestSave(action)
    },
  )

  return {
    requestSave,
    openUnpublish: () => setConfirm({ type: 'unpublish' }),
    openDelete: () => setConfirm({ type: 'delete' }),
    /** 削除に失敗したら確認を閉じる */
    closeConfirm: () => setConfirm(null),
    dialogs: (
      <>
        <ConfirmDialog
          open={confirm?.type === 'unpublish'}
          title="非公開に戻す"
          message="公開サイトから見えなくなります"
          confirmLabel="非公開に戻す"
          pending={pending === 'unpublish'}
          onConfirm={async () => {
            if (slugChanged()) {
              setConfirm({ type: 'slug', action: 'unpublish' })
              return
            }
            await submit('unpublish')
            setConfirm(null)
          }}
          onCancel={() => setConfirm(null)}
        />
        <ConfirmDialog
          open={confirm?.type === 'slug'}
          title="スラッグの変更"
          message={`スラッグを変えると、${SLUG_CHANGE_WARNING}。保存しますか？`}
          confirmLabel="保存する"
          pending={confirm?.type === 'slug' && pending !== null}
          onConfirm={async () => {
            if (confirm?.type !== 'slug') return
            await submit(confirm.action)
            setConfirm(null)
          }}
          onCancel={() => setConfirm(null)}
        />
        <ConfirmDialog
          open={confirm?.type === 'delete'}
          title="削除の確認"
          message={`『${title}』を削除します。元に戻せません`}
          confirmLabel="削除する"
          danger
          pending={pending === 'delete'}
          onConfirm={() => void remove()}
          onCancel={() => setConfirm(null)}
        />
      </>
    ),
  }
}

// ---- 表示の部品 ---------------------------------------------------------------

const LANG_NAMES: Record<Lang, string> = { ja: '日本語', en: 'English' }
const LANG_NAMES_JA: Record<Lang, string> = { ja: '日本語', en: '英語' }

/** 言語の見出し・タブの中身。言語ありなら ●、なければ ○。理由や足りない項目がある言語には「要確認」の印を足す */
export function LanguageLabel({ lang, languages, problem }: { lang: Lang; languages: Languages; problem: boolean }) {
  return (
    <>
      {LANG_NAMES[lang]}
      <span aria-hidden="true">{languages[lang] ? '●' : '○'}</span>
      <span className={css({ srOnly: true })}>{languages[lang] ? '（言語あり）' : '（言語ありでない）'}</span>
      {problem && <span className={label({ tone: 'danger' })}>要確認</span>}
    </>
  )
}

/**
 * 言語タブ（design-spec 6.7.1）。日英の両方の入力を1つのフォームに持ち、タブは表示を切り替えるだけ（ADR-008）
 */
export function LanguageTabs({
  languages,
  problems,
  panels,
  value,
  onValueChange,
}: {
  languages: Languages
  problems: Record<Lang, boolean>
  panels: Record<Lang, ReactNode>
  /** 選んでいる言語。誤りの欄へ移るときに切り替えるので、外で持つ */
  value: Lang
  onValueChange: (lang: Lang) => void
}) {
  return (
    <Tabs
      label="入力する言語"
      value={value}
      onValueChange={(next) => {
        if (next === 'ja' || next === 'en') onValueChange(next)
      }}
      items={(['ja', 'en'] as const).map((lang) => ({
        value: lang,
        label: <LanguageLabel lang={lang} languages={languages} problem={problems[lang]} />,
        content: (
          <div className={css({ display: 'flex', flexDirection: 'column', gap: 'stack-dense' })}>{panels[lang]}</div>
        ),
      }))}
    />
  )
}

/**
 * L6 の言語ごとの欄の表示（プロフィール・経歴。design-spec 6.7.1）。「片方」は言語タブ、「日英」は左右に並べる
 * （モバイル幅は縦に積む）。表示の記憶は全種類で共通の1つの値
 */
export function useLocalizedView() {
  const [view, setView] = useStoredView(FORM_VIEW_KEY, FORM_VIEWS, 'single')
  const [lang, setLang] = useState<Lang>('ja')
  return {
    view,
    setView,
    lang,
    setLang,
    /** 誤りの欄が隠れた言語タブの中なら切り替える。描き直しを待つ必要があれば true */
    reveal(key: string): boolean {
      const keyLang = key.startsWith('ja.') ? 'ja' : key.startsWith('en.') ? 'en' : null
      if (view === 'bilingual' || keyLang === null || keyLang === lang) return false
      setLang(keyLang)
      return true
    },
  }
}

export function LocalizedFields({
  state,
  languages,
  problems,
  render,
}: {
  state: ReturnType<typeof useLocalizedView>
  languages: Languages
  problems: Record<Lang, boolean>
  render: (lang: Lang) => ReactNode
}) {
  if (state.view === 'single') {
    return (
      <LanguageTabs
        value={state.lang}
        onValueChange={state.setLang}
        languages={languages}
        problems={problems}
        panels={{ ja: render('ja'), en: render('en') }}
      />
    )
  }
  return (
    <div
      className={css({
        display: 'grid',
        gap: 'stack',
        gridTemplateColumns: { base: 'minmax(0, 1fr)', tablet: 'minmax(0, 1fr) minmax(0, 1fr)' },
      })}
    >
      {(['ja', 'en'] as const).map((lang) => (
        <LocalizedColumn
          key={lang}
          heading={<LanguageLabel lang={lang} languages={languages} problem={problems[lang]} />}
        >
          {render(lang)}
        </LocalizedColumn>
      ))}
    </div>
  )
}

/** 公開に足りない項目の一覧（design-spec 6.7.3）と、欄に結びつかない理由 */
export function SaveProblems({
  missing,
  formErrors,
  fieldLabels,
}: {
  missing: MissingField[]
  formErrors: string[]
  /** 足りない項目の名前（`title`・`slug`・`startDate` など） */
  fieldLabels: Record<string, string>
}) {
  if (missing.length === 0 && formErrors.length === 0) return null
  return (
    <div
      role="alert"
      className={css({
        display: 'flex',
        flexDirection: 'column',
        gap: 'inline',
        p: 'inset',
        bg: 'danger.subtle',
        borderRadius: 'card',
        textStyle: 'body-sm',
        color: 'danger.default',
      })}
    >
      {missing.length > 0 && (
        <>
          <p>公開に必要な項目が足りません</p>
          <ul className={css({ listStyleType: 'disc', pl: 'inset' })}>
            {missing.map((item) => (
              <li key={missingKey(item)}>
                {fieldLabels[item.field] ?? item.field}
                {item.lang !== undefined && `（${LANG_NAMES_JA[item.lang]}）`}
              </li>
            ))}
          </ul>
        </>
      )}
      {formErrors.map((message) => (
        <p key={message}>{message}</p>
      ))}
    </div>
  )
}

/** 退避の復元の提案（design-spec 6.4） */
export function RestoreBanner({
  offer,
  onRestore,
  onDiscard,
}: {
  offer: BackupOffer<unknown>
  onRestore: () => void
  onDiscard: () => void
}) {
  return (
    <div
      role="status"
      className={css({
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 'inline',
        p: 'inset',
        borderWidth: 'default',
        borderStyle: 'solid',
        borderColor: 'border.default',
        borderRadius: 'card',
      })}
    >
      <div className={css({ flex: '1', textStyle: 'body-sm' })}>
        <p>一時保存した内容があります（{formatAdminTime(offer.savedAt)}）</p>
        {offer.serverNewer && (
          <p className={css({ color: 'warning.default' })}>保存済みの内容の方が新しくなっています</p>
        )}
      </div>
      <button type="button" onClick={onRestore} className={button({ variant: 'solid' })}>
        復元する
      </button>
      <button type="button" onClick={onDiscard} className={button({ variant: 'outline' })}>
        破棄する
      </button>
    </div>
  )
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <AdminLink
      href={href}
      className={css({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'inline',
        textStyle: 'ui',
        color: 'text.muted',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        _hover: { color: 'text.default' },
      })}
    >
      <ArrowLeftIcon size="sm" />
      <WideOnlyText>{children}</WideOnlyText>
    </AdminLink>
  )
}

// 丸は飾りなので疑似要素で描き、札の文字（読み上げ・テキスト）には入れない
const statusBadge = cva({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'inline-tight',
    textStyle: 'label',
    whiteSpace: 'nowrap',
    _before: { content: '"●"' },
  },
  variants: {
    tone: {
      published: { color: 'text.default', _before: { color: 'success.default' } },
      draft: { color: 'text.muted' },
    },
  },
})

/**
 * 状態の札（操作バーと一覧の「状態」列）。地の無い文字と丸（design-spec 4.4）。新規作成は「下書き（未保存）」（6.7.4）
 */
export function StatusBadge({ status }: { status: Status | null }) {
  const text = status === null ? '下書き（未保存）' : STATUS_LABELS[status]
  return <span className={statusBadge({ tone: status === 'published' ? 'published' : 'draft' })}>{text}</span>
}

/** 操作バーの保存の状態（design-spec 6.7.4）。変わったら読み上げる */
export function SaveStatus({ text, tone }: { text: string; tone: 'muted' | 'changed' }) {
  return (
    <span
      role="status"
      data-tone={tone}
      className={css({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'inline-tight',
        textStyle: 'label',
        color: 'text.muted',
        whiteSpace: 'nowrap',
        '&[data-tone=changed]': { color: 'text.default', _before: { content: '"●"', color: 'warning.default' } },
      })}
    >
      {text}
    </span>
  )
}

/** 押したボタンに出す読み込み中の印（design-spec 6.7.4） */
const BUSY_LABELS: Record<SaveAction | 'delete', string> = {
  save: '保存中…',
  saveDraft: '保存中…',
  publish: '公開中…',
  update: '更新中…',
  unpublish: '非公開に戻しています…',
  delete: '削除中…',
}

function ActionButton({
  action,
  pending,
  disabled,
  variant = 'outline',
  onClick,
  children,
}: {
  action: SaveAction | 'delete'
  pending: SaveAction | 'delete' | null
  disabled: boolean
  variant?: 'solid' | 'outline' | 'ghost'
  onClick: () => void
  children: string
}) {
  const busy = pending === action
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || pending !== null}
      aria-busy={busy}
      className={button({ variant })}
    >
      {busy ? BUSY_LABELS[action] : children}
    </button>
  )
}

/**
 * 削除のボタン。操作バーではアイコンだけにし、名前はツールチップと読み上げで伝える（design-spec 6.7 の操作バー）。
 * 削除中は押したことが分かるよう「削除中…」の文字にする。削除に失敗して確認ダイアログが閉じたとき、フォーカスが
 * このボタンへ戻れるよう、どちらの状態でも同じ button 要素のまま中身だけを替える
 */
function DeleteButton({
  pending,
  disabled,
  onClick,
}: {
  pending: SaveAction | 'delete' | null
  disabled: boolean
  onClick: () => void
}) {
  const busy = pending === 'delete'
  return (
    <Tooltip content="削除" placement="bottom">
      <button
        type="button"
        aria-label={busy ? undefined : '削除'}
        aria-busy={busy}
        onClick={onClick}
        disabled={disabled || pending !== null}
        className={button({ variant: 'ghost', shape: busy ? 'default' : 'icon' })}
      >
        {busy ? BUSY_LABELS.delete : <TrashIcon />}
      </button>
    </Tooltip>
  )
}

/** ボタンを押せない理由（design-spec 6.7.4）。ボタンの左に短く出す */
function BlockedReason({ reason }: { reason: string | null }) {
  return (
    <span
      role="status"
      className={css({ textStyle: 'label', color: 'text.muted', whiteSpace: 'nowrap', _empty: { display: 'none' } })}
    >
      {reason}
    </span>
  )
}

export interface PublishActionsProps {
  /** 今の状態。新規作成は null */
  status: Status | null
  pending: SaveAction | 'delete' | null
  /** 読み込み中・取得に失敗のときは押せない */
  disabled?: boolean
  /** ボタンを押せない理由（保存中・スラッグの作成中・アップロード中） */
  reason?: string | null
  onSave: (action: Transition) => void
  /** 非公開に戻す（確認ダイアログを出す） */
  onUnpublish: () => void
  /** 削除（確認ダイアログを出す）。新規作成では出さない */
  onDelete?: () => void
}

/**
 * 公開状態を持つ編集ビューのボタン（design-spec 6.7.1）。
 * 下書き・新規作成は「下書き保存」「公開する」、公開中は「非公開に戻す」「更新する」
 */
export function PublishActions({
  status,
  pending,
  disabled = false,
  reason = null,
  onSave,
  onUnpublish,
  onDelete,
}: PublishActionsProps) {
  const blocked = disabled || reason !== null
  return (
    <>
      <BlockedReason reason={reason} />
      {onDelete && status !== null && <DeleteButton pending={pending} disabled={blocked} onClick={onDelete} />}
      {status === 'published' ? (
        <>
          <ActionButton action="unpublish" pending={pending} disabled={blocked} onClick={onUnpublish}>
            非公開に戻す
          </ActionButton>
          <ActionButton
            action="update"
            pending={pending}
            disabled={blocked}
            variant="solid"
            onClick={() => onSave('update')}
          >
            更新する
          </ActionButton>
        </>
      ) : (
        <>
          <ActionButton action="saveDraft" pending={pending} disabled={blocked} onClick={() => onSave('saveDraft')}>
            下書き保存
          </ActionButton>
          <ActionButton
            action="publish"
            pending={pending}
            disabled={blocked}
            variant="solid"
            onClick={() => onSave('publish')}
          >
            公開する
          </ActionButton>
        </>
      )}
    </>
  )
}

/** 「保存」だけの編集ビュー（プロフィール・使用技術。design-spec 6.7.2） */
export function SaveActions({
  pending,
  disabled = false,
  reason = null,
  onSave,
  onDelete,
}: {
  pending: SaveAction | 'delete' | null
  disabled?: boolean
  reason?: string | null
  onSave: () => void
  onDelete?: () => void
}) {
  const blocked = disabled || reason !== null
  return (
    <>
      <BlockedReason reason={reason} />
      {onDelete && <DeleteButton pending={pending} disabled={blocked} onClick={onDelete} />}
      <ActionButton action="save" pending={pending} disabled={blocked} variant="solid" onClick={onSave}>
        保存
      </ActionButton>
    </>
  )
}

/** 編集ビュー（L6）の読み込み中。入力欄にスケルトン（design-spec 6.7.4） */
export function EditLoading() {
  return (
    <div className={css({ display: 'flex', flexDirection: 'column', gap: 'stack-dense' })} aria-busy="true">
      {Array.from({ length: 4 }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 中身のない形だけの欄で、並びは変わらない
        <Skeleton key={index} className={css({ h: 'control' })} />
      ))}
    </div>
  )
}

/** 取得に失敗（「読み込めませんでした」と「再試行」）。保存・公開ボタンは無効（design-spec 6.7.4） */
export function EditLoadError({ onRetry }: { onRetry: () => void }) {
  return <LoadError onRetry={onRetry} />
}

/** 存在しない ID を開いた（「見つかりませんでした」と「一覧へ戻る」。C1 は使わない。design-spec 6.7.4） */
export function EditNotFound({ listHref }: { listHref: string }) {
  return (
    <div
      className={css({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 'inline',
        py: 'inset',
      })}
    >
      <p className={css({ textStyle: 'body-sm', color: 'text.muted' })}>見つかりませんでした</p>
      <AdminLink href={listHref} className={button({ variant: 'outline' })}>
        一覧へ戻る
      </AdminLink>
    </div>
  )
}

/**
 * 編集ビューの部品の key。開いている項目（URL の id）が変わったら部品を作り直すが、新規作成で初めて保存して
 * URL を作成した項目のものに置き換えたとき（SDD 4.1）は作り直さない。作り直すと、保存の応答を待つあいだの入力と
 * 元に戻す履歴が消える。同じ id へ戻ってきたときも作り直すよう、key は開いた回ごとに変える
 */
export function useEditorKey(id: string) {
  const state = useRef({ id, key: `${id}:0`, createdId: null as string | null, count: 0 })
  if (state.current.id !== id) {
    const keep = state.current.createdId === id
    const count = state.current.count + 1
    state.current = { id, key: keep ? state.current.key : `${id}:${count}`, createdId: null, count }
  }
  return {
    key: state.current.key,
    /** 新規作成の初めての保存で、URL を置き換える前に呼ぶ */
    markCreated(createdId: string) {
      // 新規作成のビューを開いたままのときだけ覚える。保存の応答の前に別の項目へ移っていたら、その項目の部品を
      // 作成した項目の URL で使い回してしまうので覚えない
      if (state.current.id === 'new') state.current.createdId = createdId
    },
  }
}

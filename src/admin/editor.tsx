/**
 * 編集ビューの共通の仕組み（design-spec 6.4・6.7、SDD 8章）:
 * - 保存していない変更の検出と、画面を移るときの確認
 * - ログインの有効期限が切れたときの一時保存（localStorage）と、開き直したときの復元
 * - 保存ボタンの状態と、入力チェック・公開に足りない項目・重複の表示
 * - 言語タブの印、操作バーのボタン、読み込み中・取得に失敗・存在しない ID の表示
 *
 * フォームの状態は画面ごとの TanStack Form が持ち、ここは値の比較と出し方だけを受け持つ（ADR-008）
 */
import { useBlocker } from '@tanstack/react-router'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { css } from 'styled-system/css'
import type { z } from 'zod'
import type { Languages } from '~/domain/languages'
import type { MissingField, Status, Transition } from '~/domain/publishing'
import type { Lang } from '~/i18n/detect'
import { ArrowLeftIcon } from '~/ui/icons'
import { button, label } from '~/ui/recipes'
import { Tabs } from '~/ui/tabs'
import { toaster } from '~/ui/toast'
import { onBeforeLoginRedirect } from './api'
import { clearBackup, readBackup, saveBackup } from './backup'
import { ConfirmDialog } from './confirm-dialog'
import { type FieldErrors, fieldKey, issuesToErrors, missingKey, saveFailureOf } from './errors'
import { NOTICES, STATUS_LABELS } from './labels'
import { AdminLink } from './link'
import { LoadError, Skeleton } from './states'

/** フォームの値の比較。値は JSON にできる形（文字列・真偽値・配列・オブジェクト）だけを持つ */
export function sameValues(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * 期限切れの通知を読めるだけの時間、A1 へ移るのを待つ（design-spec 6.4 の「移る前に…と出す」）。
 * A1 へはページを読み込み直して移る（src/admin/api.ts）ので、移ったあとには通知を出せない
 */
const SESSION_EXPIRED_NOTICE_MS = 2500

export interface EditSessionOptions<V> {
  /** 確認のときに読む今の値。描画の途中の値ではなく、フォームの最新の状態を返す */
  getValues: () => V
  /** 最後に保存した（読み込んだ）値。これと違えば「保存していない変更」 */
  baseline: V
  /** SDD 8章の localStorage のキー */
  backupKey: string
  /** 一時保存の中身がこのフォームの形か */
  isValues: (value: unknown) => value is V
  /** 一時保存の内容をフォームに戻す（保存していない変更として） */
  restore: (values: V) => void
}

export function useEditSession<V>({ getValues, baseline, backupKey, isValues, restore }: EditSessionOptions<V>) {
  const baselineRef = useRef(baseline)
  baselineRef.current = baseline
  const keyRef = useRef(backupKey)
  keyRef.current = backupKey
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
    }
  }, [])
  const [offer, setOffer] = useState<V | null>(() => readBackup(window.localStorage, backupKey, isValues))

  useEffect(
    () =>
      onBeforeLoginRedirect(async () => {
        const current = getValuesRef.current()
        if (sameValues(current, baselineRef.current)) return
        leavingRef.current = true
        saveBackup(window.localStorage, keyRef.current, current)
        toaster.create({ title: NOTICES.sessionExpired, type: 'warning' })
        await new Promise((resolve) => setTimeout(resolve, SESSION_EXPIRED_NOTICE_MS))
      }),
    [],
  )

  const isDirty = () => !sameValues(getValuesRef.current(), baselineRef.current)

  const blocker = useBlocker({
    shouldBlockFn: () => !leavingRef.current && isDirty(),
    enableBeforeUnload: () => !leavingRef.current && isDirty(),
    withResolver: true,
  })

  return {
    /** 復元を提案している一時保存（design-spec 6.4） */
    offer,
    restoreOffer() {
      if (offer !== null) restore(offer)
      setOffer(null)
    },
    discardOffer() {
      clearBackup(window.localStorage, keyRef.current)
      setOffer(null)
    },
    /** 保存に成功したら一時保存を消す（新規作成の初めての保存では new のキー） */
    clearBackup() {
      clearBackup(window.localStorage, keyRef.current)
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
    leaveDialog: (
      <ConfirmDialog
        open={blocker.status === 'blocked'}
        title="移動の確認"
        message="保存していない変更があります。移動しますか？"
        confirmLabel="移動する"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    ),
  }
}

/** 保存の操作。公開状態を持つものは design-spec 6.7.1 の4つ、プロフィール・使用技術は「保存」だけ */
export type SaveAction = Transition | 'save'

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

/** 保存ボタンの状態（design-spec 6.7.4）と、失敗の出し方（SDD 8章） */
export function useSaveState() {
  const [pending, setPending] = useState<SaveAction | 'delete' | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formErrors, setFormErrors] = useState<string[]>([])
  const [missing, setMissing] = useState<MissingField[]>([])

  function clear() {
    setFieldErrors({})
    setFormErrors([])
    setMissing([])
  }

  async function run<O>(action: SaveAction, { check, request, onSuccess }: SaveRequest<O>): Promise<void> {
    clear()
    const invalid = check()
    if (invalid) {
      setFieldErrors(invalid.fieldErrors)
      setFormErrors(invalid.formErrors)
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
          setFieldErrors(failure.fieldErrors)
          setFormErrors(failure.formErrors)
          break
        case 'missing':
          setMissing(failure.missing)
          break
        case 'conflict':
          setFieldErrors({ [failure.field]: [`${failure.message}（候補: ${failure.suggestion}）`] })
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
    /** その言語の欄に、理由か足りない項目があるか（言語タブの印） */
    hasProblemIn(lang: Lang) {
      return (
        Object.keys(fieldErrors).some((key) => key.startsWith(`${lang}.`)) || missing.some((item) => item.lang === lang)
      )
    },
  }
}

const LANG_NAMES: Record<Lang, string> = { ja: '日本語', en: 'English' }
const LANG_NAMES_JA: Record<Lang, string> = { ja: '日本語', en: '英語' }

/**
 * 言語タブ（design-spec 6.7.1）。日英の両方の入力を1つのフォームに持ち、タブは表示を切り替えるだけ（ADR-008）。
 * 言語ありなら ●、なければ ○。理由や足りない項目がある言語には「要確認」の印を足す
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
  /** 選んでいる言語。L5 はタブの外の本文のエディタも同じ言語に切り替えるので、外で持つ */
  value?: Lang
  onValueChange?: (lang: Lang) => void
}) {
  const tabLabel = (lang: Lang) => (
    <>
      {LANG_NAMES[lang]}
      <span aria-hidden="true">{languages[lang] ? '●' : '○'}</span>
      <span className={css({ srOnly: true })}>{languages[lang] ? '（言語あり）' : '（言語ありでない）'}</span>
      {problems[lang] && <span className={label({ tone: 'danger' })}>要確認</span>}
    </>
  )
  return (
    <Tabs
      label="入力する言語"
      value={value}
      onValueChange={(next) => {
        if (next === 'ja' || next === 'en') onValueChange?.(next)
      }}
      items={(['ja', 'en'] as const).map((lang) => ({
        value: lang,
        label: tabLabel(lang),
        content: (
          <div className={css({ display: 'flex', flexDirection: 'column', gap: 'stack-dense' })}>{panels[lang]}</div>
        ),
      }))}
    />
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

/** 一時保存の復元の提案（design-spec 6.4） */
export function RestoreBanner({ onRestore, onDiscard }: { onRestore: () => void; onDiscard: () => void }) {
  return (
    <div
      role="status"
      className={css({
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 'inline',
        p: 'inset',
        bg: 'accent.subtle',
        borderRadius: 'card',
      })}
    >
      <p className={css({ textStyle: 'body-sm', flex: '1' })}>一時保存した内容があります</p>
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
        color: 'accent.default',
        textDecoration: 'none',
        alignSelf: 'flex-start',
        _hover: { textDecoration: 'underline' },
      })}
    >
      <ArrowLeftIcon size="sm" />
      {children}
    </AdminLink>
  )
}

/** 操作バーの状態の札。新規作成は「下書き（未保存）」（design-spec 6.7.4） */
export function StatusBadge({ status }: { status: Status | null }) {
  const text = status === null ? '下書き（未保存）' : STATUS_LABELS[status]
  return <span className={label({ tone: status === 'published' ? 'accent' : 'neutral' })}>{text}</span>
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

export interface PublishActionsProps {
  /** 今の状態。新規作成は null */
  status: Status | null
  pending: SaveAction | 'delete' | null
  /** 読み込み中・取得に失敗のときは押せない */
  disabled?: boolean
  onSave: (action: Transition) => void
  /** 非公開に戻す（確認ダイアログを出す） */
  onUnpublish: () => void
  /** 削除（確認ダイアログを出す）。新規作成では出さない */
  onDelete?: () => void
  /** 読み込み中・取得に失敗のとき。状態はまだわからないので札を出さない */
  hideStatus?: boolean
}

/**
 * 公開状態を持つ編集ビューのボタン（design-spec 6.7.1）。
 * 下書き・新規作成は「下書き保存」「公開する」、公開中は「非公開に戻す」「更新する」
 */
export function PublishActions({
  status,
  pending,
  disabled = false,
  onSave,
  onUnpublish,
  onDelete,
  hideStatus = false,
}: PublishActionsProps) {
  return (
    <>
      {!hideStatus && <StatusBadge status={status} />}
      {onDelete && status !== null && (
        <ActionButton action="delete" pending={pending} disabled={disabled} variant="ghost" onClick={onDelete}>
          削除
        </ActionButton>
      )}
      {status === 'published' ? (
        <>
          <ActionButton action="unpublish" pending={pending} disabled={disabled} onClick={onUnpublish}>
            非公開に戻す
          </ActionButton>
          <ActionButton
            action="update"
            pending={pending}
            disabled={disabled}
            variant="solid"
            onClick={() => onSave('update')}
          >
            更新する
          </ActionButton>
        </>
      ) : (
        <>
          <ActionButton action="saveDraft" pending={pending} disabled={disabled} onClick={() => onSave('saveDraft')}>
            下書き保存
          </ActionButton>
          <ActionButton
            action="publish"
            pending={pending}
            disabled={disabled}
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
  onSave,
  onDelete,
}: {
  pending: SaveAction | 'delete' | null
  disabled?: boolean
  onSave: () => void
  onDelete?: () => void
}) {
  return (
    <>
      {onDelete && (
        <ActionButton action="delete" pending={pending} disabled={disabled} variant="ghost" onClick={onDelete}>
          削除
        </ActionButton>
      )}
      <ActionButton action="save" pending={pending} disabled={disabled} variant="solid" onClick={onSave}>
        保存
      </ActionButton>
    </>
  )
}

/** 編集ビューの読み込み中。入力欄にスケルトン、ボタンは無効（design-spec 6.7.4） */
export function EditLoading({ actions }: { actions: ReactNode }) {
  return (
    <div className={css({ display: 'flex', flexDirection: 'column', gap: 'stack-dense' })} aria-busy="true">
      <div className={css({ display: 'flex', justifyContent: 'flex-end', gap: 'inline' })}>{actions}</div>
      {Array.from({ length: 4 }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 中身のない形だけの欄で、並びは変わらない
        <Skeleton key={index} className={css({ h: 'control' })} />
      ))}
    </div>
  )
}

/** 取得に失敗（「読み込めませんでした」と「再試行」）。保存・公開ボタンは無効（design-spec 6.7.4） */
export function EditLoadError({ onRetry, actions }: { onRetry: () => void; actions: ReactNode }) {
  return (
    <div className={css({ display: 'flex', flexDirection: 'column', gap: 'stack-dense' })}>
      <div className={css({ display: 'flex', justifyContent: 'flex-end', gap: 'inline' })}>{actions}</div>
      <LoadError onRetry={onRetry} />
    </div>
  )
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

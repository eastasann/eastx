/**
 * 編集ビューの操作と表示の規則（design-spec 6.7.1・6.7.3・6.7.4）。React から切り離した純粋関数で、
 * 編集ビューの部品（editor.tsx・layouts.tsx）が使う
 */
import type { Status, Transition } from '~/domain/publishing'
import { formatAdminTime } from '~/i18n/format'

/** 保存の操作。公開状態を持つものは design-spec 6.7.1 の4つ、プロフィール・使用技術は「保存」だけ */
export type SaveAction = Transition | 'save'

/** 編集ビューの種類ごとの保存の形。公開状態を持つか（作品・プロジェクト・ブログ・記録・経歴）、持たないか */
export type SaveKind = 'publishable' | 'plain'

export interface ShortcutState {
  kind: SaveKind
  /** 公開状態。新規作成（まだ保存していない）と、状態を持たないものは null */
  status: Status | null
  /** 保存していない変更があるか。新規作成は空のフォームの初期値と違うか */
  dirty: boolean
  /** ボタンを押せない（保存中・スラッグの作成中・画像のアップロード中） */
  blocked: boolean
  /** モーダルの確認ダイアログ（削除・非公開に戻す・スラッグの変更・移動の確認）が開いている */
  confirming: boolean
}

/**
 * Cmd/Ctrl+S で行う保存（design-spec 6.7.1 の割り当て）。今の状態を変えない保存で、送らないときは null。
 * null のときも、呼び出し側はブラウザの「ページを保存」を止める
 */
export function shortcutAction({ kind, status, dirty, blocked, confirming }: ShortcutState): SaveAction | null {
  if (!dirty || blocked || confirming) return null
  if (kind === 'plain') return 'save'
  return status === 'published' ? 'update' : 'saveDraft'
}

/** Cmd/Ctrl+S のキーか。IME の変換中は無視する。Caps Lock 中は key が大文字になるので、大文字小文字を区別しない */
export function isSaveShortcut(event: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  isComposing: boolean
}): boolean {
  return (
    !event.isComposing &&
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === 's'
  )
}

export interface SaveStatusState {
  /** まだ一度も保存していない新規作成 */
  isNew: boolean
  dirty: boolean
  saving: boolean
  /** 最後に読んだ・保存したサーバーの updatedAt */
  updatedAt: string | null
  now?: Date
}

/** 操作バーの保存の状態（design-spec 6.7.4）。変更ありは「● 未保存の変更」の文字の部分（● は部品が付ける） */
export function saveStatusText({ isNew, dirty, saving, updatedAt, now = new Date() }: SaveStatusState): {
  text: string
  tone: 'muted' | 'changed'
} {
  if (saving) return { text: '保存しています…', tone: 'muted' }
  if (isNew) return { text: '未保存', tone: 'muted' }
  if (dirty) return { text: '未保存の変更', tone: 'changed' }
  if (updatedAt === null) return { text: '保存済み', tone: 'muted' }
  return { text: `保存済み ${formatAdminTime(updatedAt, now)}`, tone: 'muted' }
}

/** ボタンを押せなくする処理の種類。キーの頭で分ける（`slug`・`upload-…`） */
export function blockedReason(saving: boolean, busyKeys: readonly string[]): string | null {
  if (saving) return '保存しています'
  if (busyKeys.some((key) => key.startsWith('upload'))) return '画像をアップロードしています'
  if (busyKeys.some((key) => key.startsWith('slug'))) return 'スラッグを作っています'
  return null
}

/**
 * 最初の誤りの欄（design-spec 6.7.3）。`order` は欄のキーを「言語ごとの欄（日→英）→ 本文（日→英）→
 * 設定パネル」の順に並べたもの。`order` に無いキー（SNS リンクの行など）は、並びの最後に見つかった順で続ける
 */
export function firstErrorField(order: readonly string[], errorKeys: readonly string[]): string | null {
  const errors = new Set(errorKeys)
  for (const key of order) {
    if (errors.has(key)) return key
    // 配列の欄（`stacks` に対する `stackIds`、`socialLinks` に対する `socialLinks.0.url`）は頭が一致すれば同じ欄
    for (const error of errors) if (error.startsWith(`${key}.`)) return error
  }
  return errorKeys[0] ?? null
}

/**
 * 上限のある欄の文字数の表示（design-spec 6.7.3）。上限の8割を超えたら「n / 上限」を出し、上限を超えたら赤字。
 * 数え方は保存の入力チェック（Zod の trim の後の max）と同じ
 */
export function counterState(value: string, limit: number): { text: string; over: boolean } | null {
  const length = value.trim().length
  if (length * 10 <= limit * 8) return null
  return { text: `${length} / ${limit}`, over: length > limit }
}

/** 保存しようとして見つかった誤りの件数の通知（design-spec 6.7.3） */
export function problemsNotice(count: number): string {
  return `確かめる項目があります（${count}件）`
}

/** 公開したことがあるもののスラッグを変えたときの警告（design-spec 6.7.2） */
export const SLUG_CHANGE_WARNING = '今のURLは見られなくなります'

/**
 * 編集ビューの自動退避（design-spec 6.4、SDD ADR-008・8章）。保存していない変更があるあいだ、フォームの状態を
 * localStorage に `{ savedAt, values }` の形で置き、タブやブラウザが落ちても次に開いたときに復元を提案する。
 * キーは `eastx:backup:{種類}:{id か new}`
 */

/** 退避を持つ編集ビューの種類 */
export type BackupType = 'profile' | 'career' | 'stack' | 'work' | 'project' | 'blog-post' | 'coding-log' | 'privacy'

const PREFIX = 'eastx:backup:'

export function backupKey(type: BackupType, id: string | null): string {
  return `${PREFIX}${type}:${id ?? 'new'}`
}

/** 退避した内容。savedAt はブラウザの時計の ISO 8601 */
export interface Backup<T> {
  savedAt: string
  values: T
}

/**
 * ログアウトしたら、ページを読み込み直すまで退避を書かない。ログアウトの応答を待つあいだに、編集ビューの待っていた書き込みが
 * 消したあとの localStorage に書き戻さないため
 */
let stopped = false

export function saveBackup(storage: Storage, key: string, values: unknown, now = new Date()): void {
  if (stopped) return
  const stored: Backup<unknown> = { savedAt: now.toISOString(), values }
  try {
    storage.setItem(key, JSON.stringify(stored))
  } catch {
    // 容量の上限などで書けないときは、退避なしで編集を続ける（保存はサーバーへの保存で行う）
  }
}

/** このブラウザの localStorage。使えない（ブロックされた・プライベートモードの制限）ときは null */
export function browserStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * 退避を読む。形の違う値（手で書き換えられた・壊れた）は無いものとして扱い、消す。
 * 値の中身は呼び出し側の `parseValues` で今のフォームの形に読み直す（フォームの形は画面ごとに違う）。
 * 形が合わなければ `parseValues` は null を返す。あとから足した欄が無い退避は、その欄を空にして返してよい（design-spec 6.4）
 */
export function readBackup<T>(
  storage: Storage,
  key: string,
  parseValues: (value: unknown) => T | null,
): Backup<T> | null {
  const raw = storage.getItem(key)
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'savedAt' in parsed &&
      typeof parsed.savedAt === 'string' &&
      !Number.isNaN(Date.parse(parsed.savedAt)) &&
      'values' in parsed
    ) {
      const values = parseValues(parsed.values)
      if (values !== null) return { savedAt: parsed.savedAt, values }
    }
  } catch {
    // 下で消す
  }
  storage.removeItem(key)
  return null
}

export function clearBackup(storage: Storage, key: string): void {
  storage.removeItem(key)
}

/**
 * ログアウトに成功したら呼ぶ: 以後（ページを読み込み直すまで）退避を書かず、すべての編集ビューの退避を消す（design-spec 6.4）
 */
export function stopAndClearBackups(storage: Storage | null): void {
  stopped = true
  if (storage !== null) clearAllBackups(storage)
}

/** すべての編集ビューの退避を消す */
export function clearAllBackups(storage: Storage): void {
  const keys: string[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (key?.startsWith(PREFIX)) keys.push(key)
  }
  for (const key of keys) storage.removeItem(key)
}

/** 復元の提案（design-spec 6.4） */
export interface BackupOffer<T> extends Backup<T> {
  /** サーバーの最終保存の方が退避より新しい（「保存済みの内容の方が新しくなっています」を添える） */
  serverNewer: boolean
}

/** フォームの値の比較。値は JSON にできる形（文字列・真偽値・配列・オブジェクト）だけを持つ */
export function sameValues(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** 退避を書くまで待つ時間。打鍵のたびに localStorage へ書かない */
export const BACKUP_DELAY_MS = 1000

export interface AutoBackupOptions<V> {
  /** null（localStorage を使えない）なら何もしない */
  storage: Storage | null
  key: string
  /** 比べる元。既存の項目は最後に読んだ・保存したサーバーの内容、新規作成は空のフォームの初期値 */
  baseline: V
  /**
   * 比べるときの形。フォームが比較に関係ない値（並べ替えの目印の ID など）を持つときに、それを外す。
   * 省くと値そのものを比べる
   */
  comparable?: (values: V) => unknown
  delayMs?: number
  now?: () => Date
}

/**
 * 自動退避の規則（design-spec 6.4 の表）。React から切り離し、退避を書く・消す時を1か所で決める。
 * 開いた直後は何もしない（`changed` が呼ばれるまで書きも消しもしない）。復元を提案しているあいだは、保存や期限切れが
 * あっても書きも消しもしない（提案した退避は「復元する」「破棄する」で答えるまで残す）
 */
export class AutoBackup<V> {
  private readonly storage: Storage | null
  private key: string
  private baseline: V
  private readonly comparable: (values: V) => unknown
  private readonly delayMs: number
  private readonly now: () => Date
  private timer: ReturnType<typeof setTimeout> | null = null
  private pending: V | null = null
  private offering = false

  constructor({
    storage,
    key,
    baseline,
    comparable = (values) => values,
    delayMs = BACKUP_DELAY_MS,
    now,
  }: AutoBackupOptions<V>) {
    this.storage = storage
    this.key = key
    this.baseline = baseline
    this.comparable = comparable
    this.delayMs = delayMs
    this.now = now ?? (() => new Date())
  }

  /**
   * 開いたときの復元の提案。退避が比べる元と同じなら、提案せずに消す。
   * `serverUpdatedAt` は既存の項目のサーバーの最終保存（新規作成は null）
   */
  takeOffer(parseValues: (value: unknown) => V | null, serverUpdatedAt: string | null): BackupOffer<V> | null {
    if (this.storage === null) return null
    const backup = readBackup(this.storage, this.key, parseValues)
    if (backup === null) return null
    if (this.isClean(backup.values)) {
      clearBackup(this.storage, this.key)
      return null
    }
    this.offering = true
    // 時計のずれは許す（管理者1人がふだん同じ端末で使う）。サーバーとブラウザの時刻をそのまま比べる
    const serverNewer = serverUpdatedAt !== null && Date.parse(serverUpdatedAt) > Date.parse(backup.savedAt)
    return { ...backup, serverNewer }
  }

  /** 値が変わった。待ってから、比べる元と違えば書き、同じなら消す */
  changed(values: V): void {
    if (this.offering) return
    this.cancelTimer()
    this.pending = values
    this.timer = setTimeout(() => {
      this.timer = null
      const latest = this.pending
      this.pending = null
      if (latest !== null) this.settle(latest)
    }, this.delayMs)
  }

  /** 「復元する」: 復元した値を最初の退避として扱う */
  restored(values: V): void {
    this.offering = false
    this.cancelTimer()
    this.settle(values)
  }

  /** 「破棄する」: 提案した退避を捨て、提案のあいだに入力した今の値で決め直す */
  discarded(values: V): void {
    this.offering = false
    this.cancelTimer()
    this.settle(values)
  }

  /** 復元を提案している */
  get isOffering(): boolean {
    return this.offering
  }

  /**
   * 保存に成功した。比べる元を保存した内容にし、今の値で決め直す（保存の通信中にさらに入力していれば、今の値で書き直す）。
   * 新規作成の初めての保存では `key` が `new` から `{id}` に変わるので、`new` のキーを消す
   */
  saved({ key, baseline, values }: { key: string; baseline: V; values: V }): void {
    this.cancelTimer()
    this.baseline = baseline
    // 提案しているあいだは、提案した退避を消さない（答えるまで残す）。比べる元だけを新しくする
    if (this.offering) return
    if (key !== this.key) this.remove()
    this.key = key
    this.settle(values)
  }

  /** ログインの期限切れで A1 へ移す前: 待たずに書く（比べる元と同じなら書かない）。消さない */
  flush(values: V): void {
    this.cancelTimer()
    if (this.offering || this.storage === null || this.isClean(values)) return
    saveBackup(this.storage, this.key, values, this.now())
  }

  /** 削除した・「移動しますか？」で移動を選んだ */
  clear(): void {
    this.cancelTimer()
    this.offering = false
    this.remove()
  }

  /** 編集ビューを閉じた。待っている書き込みは捨てる（変更があれば移動の確認で決まっている） */
  dispose(): void {
    this.cancelTimer()
  }

  isClean(values: V): boolean {
    return sameValues(this.comparable(values), this.comparable(this.baseline))
  }

  private settle(values: V): void {
    if (this.storage === null) return
    if (this.isClean(values)) clearBackup(this.storage, this.key)
    else saveBackup(this.storage, this.key, values, this.now())
  }

  private remove(): void {
    if (this.storage !== null) clearBackup(this.storage, this.key)
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.pending = null
  }
}

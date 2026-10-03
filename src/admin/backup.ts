/**
 * ログインの期限切れのときの一時保存（design-spec 6.4、SDD 8章）。
 * キーは `eastx:backup:{種類}:{id か new}` で、値はフォームの状態そのもの（ADR-008）
 */

/** 一時保存を持つ編集ビューの種類 */
export type BackupType = 'profile' | 'career' | 'stack' | 'work' | 'project' | 'blog-post' | 'coding-log'

export function backupKey(type: BackupType, id: string | null): string {
  return `eastx:backup:${type}:${id ?? 'new'}`
}

interface Stored {
  savedAt: string
  values: unknown
}

export function saveBackup(storage: Storage, key: string, values: unknown, now = new Date()): void {
  const stored: Stored = { savedAt: now.toISOString(), values }
  storage.setItem(key, JSON.stringify(stored))
}

/**
 * 一時保存を読む。形の違う値（手で書き換えられた・古い形）は無いものとして扱い、消す。
 * 値の中身の形は呼び出し側の `isValues` で確かめる（フォームの形は画面ごとに違う）
 */
export function readBackup<T>(storage: Storage, key: string, isValues: (value: unknown) => value is T): T | null {
  const raw = storage.getItem(key)
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && 'values' in parsed && isValues(parsed.values)) {
      return parsed.values
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

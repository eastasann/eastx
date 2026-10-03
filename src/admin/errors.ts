/**
 * 保存の失敗を、編集ビューの出し方ごとに分ける（SDD 8章「フロントエンドでの表示方針」、design-spec 6.7.3・6.7.4）。
 * 入力欄の名前は API の `fieldErrors` のキー（`ja.title`・`socialLinks.0.url` のような点区切り）にそろえる（ADR-008）
 */
import { isDefinedError, ORPCError } from '@orpc/client'
import type { MissingField } from '~/domain/publishing'

export type FieldErrors = Record<string, string[]>

/**
 * TanStack Form の欄の名前（配列は `socialLinks[0].url`）を、`fieldErrors` のキー（`socialLinks.0.url`）にする
 */
export function fieldKey(name: string): string {
  return name.replace(/\[(\d+)\]/g, '.$1')
}

/** 公開に足りない項目の欄のキー。言語ごとの項目は `en.title` のように言語を前に付ける */
export function missingKey(missing: MissingField): string {
  return missing.lang === undefined ? missing.field : `${missing.lang}.${missing.field}`
}

interface Issue {
  message: string
  path?: ReadonlyArray<PropertyKey | { key: PropertyKey }> | undefined
}

/** Standard Schema の issues を、サーバーの INPUT_VALIDATION_FAILED と同じ形にする（src/api/errors.ts と同じ規則） */
export function issuesToErrors(issues: readonly Issue[]): { fieldErrors: FieldErrors; formErrors: string[] } {
  const fieldErrors: FieldErrors = {}
  const formErrors: string[] = []
  for (const issue of issues) {
    const key = (issue.path ?? [])
      .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
      .join('.')
    if (key === '') formErrors.push(issue.message)
    else fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message]
  }
  return { fieldErrors, formErrors }
}

export type SaveFailure =
  | { kind: 'invalid'; fieldErrors: FieldErrors; formErrors: string[] }
  | { kind: 'missing'; missing: MissingField[] }
  | { kind: 'conflict'; field: 'slug' | 'key'; message: string; suggestion: string }
  /** ログインの期限切れ・管理者でない。API クライアントが画面を移すので、編集ビューは何も出さない（src/admin/api.ts） */
  | { kind: 'auth' }
  | { kind: 'failed' }

export function saveFailureOf(error: unknown): SaveFailure {
  if (!(error instanceof ORPCError)) return { kind: 'failed' }
  if (error.code === 'UNAUTHORIZED' || error.code === 'FORBIDDEN') return { kind: 'auth' }
  if (!isDefinedError(error)) return { kind: 'failed' }
  const data: unknown = error.data
  switch (error.code) {
    case 'INPUT_VALIDATION_FAILED': {
      const { fieldErrors, formErrors } = data as { fieldErrors: FieldErrors; formErrors: string[] }
      return { kind: 'invalid', fieldErrors, formErrors }
    }
    case 'PUBLISH_REQUIREMENTS_NOT_MET':
      return { kind: 'missing', missing: (data as { missing: MissingField[] }).missing }
    case 'SLUG_CONFLICT':
      return {
        kind: 'conflict',
        field: 'slug',
        message: error.message,
        suggestion: (data as { suggestion: string }).suggestion,
      }
    case 'STACK_KEY_CONFLICT':
      return {
        kind: 'conflict',
        field: 'key',
        message: error.message,
        suggestion: (data as { suggestion: string }).suggestion,
      }
    default:
      return { kind: 'failed' }
  }
}

/** 認可のエラー（API クライアントが画面を移すもの）か。一覧や削除の失敗の通知を出さないために使う */
export function isAuthError(error: unknown): boolean {
  return error instanceof ORPCError && (error.code === 'UNAUTHORIZED' || error.code === 'FORBIDDEN')
}

/** NOT_FOUND（存在しない ID を開いた。design-spec 6.7.4） */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof ORPCError && error.code === 'NOT_FOUND'
}

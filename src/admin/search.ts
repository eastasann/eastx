/**
 * 一覧の絞り込みのクエリ（SDD 4.1）。決まった値のどれでもないときは絞り込まない
 */
export function pickEnum<T extends string>(value: unknown, values: readonly T[]): T | undefined {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : undefined
}

/** 絞り込みのセレクトで「すべて」を表す値 */
export const ALL = 'all'

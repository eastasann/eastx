/**
 * 公開側の読み取り（src/content/）で共通の部品
 */
import { isNotNull, or, type SQL, sql } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { Db } from '~/db/client'
import type { project, work } from '~/db/schema'

export interface ContentContext {
  db: Db
  /** 絶対 URL と、Markdown の外部リンクの判定に使う（SDD 3.2 の SITE_URL） */
  siteUrl: string
}

/** 公開中の行で、CHECK 制約が空を許さない値（スラッグ・公開日・開始年月・どちらかの言語のタイトル）。空なら DB の制約が壊れている */
export function required<T>(value: T | null, column: string): T {
  if (value === null) throw new Error(`公開中の行の ${column} が空`)
  return value
}

/** 詳細本文が日英のどちらかにあるか（src/domain/detail.ts と同じ規則）。API は空白だけの本文を NULL で保存する（SDD 5.0） */
export function hasDetailSql(table: typeof work | typeof project): SQL<boolean> {
  return sql`(${or(isNotNull(table.bodyJa), isNotNull(table.bodyEn))})`.mapWith(Boolean)
}

/**
 * 本文の有無だけを読む（言語ありの判定に使う）。本文の全文は読まない。
 * API は空白だけの本文を NULL で保存する（SDD 5.0）ので、NULL でなければ中身がある
 */
export function bodyPresence(column: SQLiteColumn): SQL<string | null> {
  return sql<string | null>`case when ${column} is null then null else '1' end`
}

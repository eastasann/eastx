/**
 * 公開中だけを読むためのクエリの部品（SDD 7章）。公開側のクエリは、公開状態を持つテーブルを読むとき必ずこれを条件に入れる。
 * 個別のクエリで `status = 'published'` を書かないことで、書き忘れて下書きを出す事故を防ぐ
 */
import { eq, type SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'

export function published(table: { status: SQLiteColumn }): SQL {
  return eq(table.status, 'published')
}

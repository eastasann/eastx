/**
 * シードを D1 に入れる。`seed.ts`（ローカルの D1）と結合テスト（テスト用の D1）で共通に使う。
 */

import { getTableColumns } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import * as schema from '../../src/db/schema'
import type { SeedData } from './data'

/** D1 の1文あたりのバインドパラメーターの上限（ADR-006） */
const MAX_PARAMS_PER_STATEMENT = 100

type Db = DrizzleD1Database<typeof schema>

/**
 * 1行のパラメーターは多くてもカラム数なので、上限をカラム数で割った行数ずつに分けて insert する
 */
function chunkedInserts<T extends SQLiteTable>(db: Db, table: T, rows: T['$inferInsert'][]): BatchItem<'sqlite'>[] {
  const perStatement = Math.floor(MAX_PARAMS_PER_STATEMENT / Object.keys(getTableColumns(table)).length)
  const statements: BatchItem<'sqlite'>[] = []
  for (let i = 0; i < rows.length; i += perStatement) {
    statements.push(db.insert(table).values(rows.slice(i, i + perStatement)))
  }
  return statements
}

/**
 * 中身のテーブルを空にしてからシードを入れる。1回の `db.batch()` で送るので、途中で失敗すれば何も変わらない。
 * 管理者のテーブル（admin_*・auth_verification）は消さない。管理者はシードで作らず（ADR-009）、
 * ローカルでログインして作った管理者とセッションを入れ直しのたびに失わないため。
 */
export async function insertSeed(db: Db, data: SeedData): Promise<void> {
  // work_stack・project_stack は親の削除で ON DELETE CASCADE により消える
  await db.batch([
    db.delete(schema.work),
    db.delete(schema.project),
    db.delete(schema.stack),
    db.delete(schema.career),
    db.delete(schema.socialLink),
    db.delete(schema.profile),
    db.delete(schema.blogPost),
    db.delete(schema.codingLog),
    ...chunkedInserts(db, schema.profile, data.profile),
    ...chunkedInserts(db, schema.socialLink, data.socialLinks),
    ...chunkedInserts(db, schema.career, data.careers),
    ...chunkedInserts(db, schema.stack, data.stacks),
    ...chunkedInserts(db, schema.work, data.works),
    ...chunkedInserts(db, schema.workStack, data.workStacks),
    ...chunkedInserts(db, schema.project, data.projects),
    ...chunkedInserts(db, schema.projectStack, data.projectStacks),
    ...chunkedInserts(db, schema.blogPost, data.blogPosts),
    ...chunkedInserts(db, schema.codingLog, data.codingLogs),
  ])
}

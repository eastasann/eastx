/**
 * 変換したデータを、`wrangler d1 execute --file` で流す SQL にする（docs/04_deployment-procedure.md 3章 Step 7）。
 * insert の文は Drizzle にスキーマから組み立てさせ、カラム名・値の変換（日時は UNIX ミリ秒、真偽値は 0/1）を
 * アプリと揃える。ファイルではバインドパラメーターを渡せないので、値は SQL のリテラルに埋め込む。
 * そのためパラメーターの上限（ADR-006）は掛からず、掛かるのは1文の長さの上限になる。
 */
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import * as schema from '../../src/db/schema'
import type { MigrationData } from './transform'

/** D1 の1文の長さの上限（バイト） */
export const MAX_STATEMENT_BYTES = 100_000

// toSQL() で文を組み立てるだけで、DB には問い合わせない
const db = drizzle(async () => {
  throw new Error('SQL の組み立て専用のクライアントで問い合わせた')
})

const bytes = (s: string) => new TextEncoder().encode(s).byteLength

export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`SQL に入れられない数値: ${value}`)
    return String(value)
  }
  if (typeof value === 'string') {
    // NUL は SQLite が文の終わりとして読み、対になっていないサロゲートはファイルに書くときに別の文字に置き換わる
    // （u フラグの \p{Cs} は、対になったサロゲートを1文字として読むので、対になっていないものだけに当たる）
    if (value.includes('\u0000') || /\p{Cs}/u.test(value)) throw new Error(`SQL に入れられない文字を含む: ${value}`)
    return `'${value.replaceAll("'", "''")}'`
  }
  throw new Error(`SQL に入れられない値の型: ${typeof value}`)
}

/** `?` を順に値のリテラルに置き換える。Drizzle の insert の文は、値の位置にだけ `?` を置く */
function inline(sql: string, params: unknown[]): string {
  let i = 0
  const out = sql.replace(/\?/g, () => {
    if (i >= params.length) throw new Error('パラメーターの数が合わない')
    return sqlLiteral(params[i++])
  })
  if (i !== params.length) throw new Error('パラメーターの数が合わない')
  return out
}

function insertSql<T extends SQLiteTable>(table: T, rows: T['$inferInsert'][]): string {
  const { sql, params } = db.insert(table).values(rows).toSQL()
  return `${inline(sql, params)};`
}

/** 1文の長さの上限に収まるだけの行をまとめて insert する。1行で上限を超えるなら止める */
function inserts<T extends SQLiteTable>(table: T, rows: T['$inferInsert'][]): string[] {
  const statements: string[] = []
  let batch: T['$inferInsert'][] = []
  for (const row of rows) {
    if (batch.length > 0 && bytes(insertSql(table, [...batch, row])) > MAX_STATEMENT_BYTES) {
      statements.push(insertSql(table, batch))
      batch = []
    }
    batch.push(row)
    if (batch.length === 1 && bytes(insertSql(table, batch)) > MAX_STATEMENT_BYTES) {
      throw new Error(
        `1行で D1 の1文の長さの上限（${MAX_STATEMENT_BYTES} バイト）を超える: ${JSON.stringify(row).slice(0, 200)}`,
      )
    }
  }
  if (batch.length > 0) statements.push(insertSql(table, batch))
  return statements
}

/**
 * 親のテーブルから順に insert する。消す文は入れない: 流す先は中身が空であること（04 3章 Step 7）を前提にし、
 * 空でなければ一意制約（プロフィールの singleton・ID）で失敗させ、管理画面で入れたものを上書きしない
 */
export function buildSql(data: MigrationData): string {
  return [
    '-- scripts/migrate-legacy/migrate.ts が作った。今のサイトのデータ（design-spec 9章）',
    ...inserts(schema.profile, data.profile),
    ...inserts(schema.socialLink, data.socialLinks),
    ...inserts(schema.stack, data.stacks),
    ...inserts(schema.career, data.careers),
    ...inserts(schema.work, data.works),
    ...inserts(schema.workStack, data.workStacks),
    ...inserts(schema.project, data.projects),
    ...inserts(schema.projectStack, data.projectStacks),
    '',
  ].join('\n')
}

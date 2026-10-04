import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { fakeMediaPath, legacyFixture } from './fixture'
import { legacyCounts } from './legacy'
import { buildSql, MAX_STATEMENT_BYTES, sqlLiteral } from './sql'
import { transform } from './transform'

const MIGRATIONS = path.join(import.meta.dirname, '..', '..', 'drizzle', 'migrations')

/** マイグレーションだけを当てた空の DB（D1 と同じく外部キーを有効にする） */
function emptyDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    db.exec(readFileSync(path.join(MIGRATIONS, file), 'utf8'))
  }
  return db
}

describe('sqlLiteral', () => {
  it('文字列の引用符を重ね、null・数値をそのまま書く', () => {
    expect(sqlLiteral("it's")).toBe("'it''s'")
    expect(sqlLiteral(null)).toBe('null')
    expect(sqlLiteral(1666757517754)).toBe('1666757517754')
    expect(() => sqlLiteral(Number.NaN)).toThrow()
    expect(() => sqlLiteral({})).toThrow()
  })

  it('NUL と対になっていないサロゲートは止め、対になったサロゲート（絵文字）は通す', () => {
    expect(() => sqlLiteral('a\u0000b')).toThrow()
    expect(() => sqlLiteral('a\uD800b')).toThrow()
    expect(sqlLiteral('🔮')).toBe("'🔮'")
  })
})

describe('buildSql', () => {
  const resume = legacyFixture()
  const sql = buildSql(transform(resume, fakeMediaPath))

  it('空の DB に CHECK 制約・外部キーに触れずに入り、取り出した件数と一致する', () => {
    const db = emptyDb()
    db.exec(sql)
    for (const [table, n] of Object.entries(legacyCounts(resume))) {
      expect(db.prepare(`select count(*) as n from "${table}"`).get(), table).toEqual({ n })
    }
  })

  it('値をアプリと同じ形で入れる（日時は UNIX ミリ秒、真偽値は 0/1、引用符を含む文字列）', () => {
    const db = emptyDb()
    db.exec(sql)
    expect(db.prepare("select body_en, created_at from career where kind = 'education'").get()).toEqual({
      body_en: "I researched a robot's leg mechanisms.",
      created_at: Date.parse('2022-11-06T07:02:26.328Z'),
    })
    expect(db.prepare("select show_on_top from stack where key = 'typescript'").get()).toEqual({ show_on_top: 1 })
    expect(db.prepare('select singleton from profile').get()).toEqual({ singleton: 1 })
  })

  it('中身が空でない DB には入らない（プロフィールの一意制約で止まる）', () => {
    const db = emptyDb()
    db.exec(sql)
    expect(() => db.exec(sql)).toThrow(/UNIQUE/)
  })

  it('1文の長さの上限に収まるよう文を分け、1行で超えるものは止める', () => {
    const data = transform(legacyFixture(), fakeMediaPath)
    const career = data.careers[0]
    if (!career) throw new Error('fixture に経歴が無い')
    const long = (n: number) => ({ ...career, id: crypto.randomUUID(), bodyJa: 'あ'.repeat(n) })
    // 全角は3バイトなので、1行が約3万バイト。3行ずつしか入らない
    data.careers = Array.from({ length: 7 }, () => long(10_000))
    const statements = buildSql(data)
      .split('\n')
      .filter((line) => line.startsWith('insert into "career"'))
    expect(statements).toHaveLength(3)
    for (const st of statements)
      expect(new TextEncoder().encode(st).byteLength).toBeLessThanOrEqual(MAX_STATEMENT_BYTES)
    const db = emptyDb()
    db.exec(buildSql(data))
    expect(db.prepare('select count(*) as n from career').get()).toEqual({ n: 7 })

    data.careers = [long(40_000)]
    expect(() => buildSql(data)).toThrow('1文の長さの上限')
  })
})

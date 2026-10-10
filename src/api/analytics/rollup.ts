/**
 * Cron の日ごとの集計（SDD ADR-023）。Analytics Engine の保持（3か月）を超えて推移を見るため、日ごとの集計を D1 に残す。
 * どの日を集計するかの規則は src/domain/analytics/rollup.ts
 */
import { asc, eq } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { analyticsDaily, analyticsRollup } from '../../db/schema'
import { addDays, jstDateOf } from '../../domain/analytics/dates'
import { chunk, datesToRollUp, startDateOf } from '../../domain/analytics/rollup'
import { captureServerError } from '../../monitoring/server'
import { log } from '../log'
import { type DailyRows, queryDailyRows, queryOldestEventDate } from './queries'
import { prepareSalt } from './salt'
import type { SqlApiConfig } from './sql'

/** 1文の行数。1行に5つのパラメーターで、D1 の1文の上限（100個。ADR-006）に収める */
const ROWS_PER_STATEMENT = 20

/**
 * 1日ぶんを1回の db.batch() で書き直す（全体が1つのトランザクションで、途中で失敗すれば何も残らない）。
 * 同じ日を何度集計しても、Cron が二重に動いても結果は同じになる
 */
export async function writeDay(db: Db, date: string, rows: DailyRows, rolledUpAt: Date): Promise<void> {
  const values = [...rows].flatMap(([dimension, counts]) => counts.map((row) => ({ date, dimension, ...row })))
  await db.batch([
    db.delete(analyticsDaily).where(eq(analyticsDaily.date, date)),
    ...chunk(values, ROWS_PER_STATEMENT).map((part) => db.insert(analyticsDaily).values(part)),
    db
      .insert(analyticsRollup)
      .values({ date, rolledUpAt })
      .onConflictDoUpdate({ target: analyticsRollup.date, set: { rolledUpAt } }),
  ])
}

export interface RollUpResult {
  rolledUp: string[]
  failed: string[]
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

/**
 * 集計する日を決めて、1日ずつ集計して書く。1日の失敗（SQL API の 4xx・5xx、D1 のエラー）は ERROR のログと Sentry に送り、
 * その日は analytics_rollup に入らないので次の実行でやり直す
 */
export async function rollUp(input: {
  db: Db
  config: SqlApiConfig
  now: number
  requestId: string
}): Promise<RollUpResult> {
  const { db, config, now, requestId } = input
  const today = jstDateOf(now)
  const rolledUpRows = await db
    .select({ date: analyticsRollup.date })
    .from(analyticsRollup)
    .orderBy(asc(analyticsRollup.date))
  const rolledUp = new Set(rolledUpRows.map((row) => row.date))
  const oldestRolledUp = rolledUpRows[0]?.date ?? null
  const startDate = startDateOf(oldestRolledUp, await queryOldestEventDate(config))
  const result: RollUpResult = { rolledUp: [], failed: [] }
  for (const date of datesToRollUp({ today, startDate, rolledUp })) {
    try {
      await writeDay(db, date, await queryDailyRows(config, date), new Date(now))
      result.rolledUp.push(date)
    } catch (error) {
      result.failed.push(date)
      log('error', { msg: 'analytics rollup failed', requestId, route: 'scheduled', date, error: errorText(error) })
      captureServerError(error, requestId)
    }
  }
  log('info', { msg: 'analytics rollup', requestId, route: 'scheduled', ...result })
  return result
}

/**
 * Cron の1回（毎日 00:15 JST。wrangler.jsonc の本番の triggers）。集計のあとに、明日の日ごとの値を KV に作る。
 * どちらかが失敗しても、もう一方は行う
 */
export async function runAnalyticsCron(input: {
  db: Db
  config: SqlApiConfig | null
  salts: KVNamespace | undefined
  now: number
}): Promise<void> {
  const { db, config, salts, now } = input
  const requestId = `cron:${new Date(now).toISOString()}`
  if (config === null) {
    // 本番で API トークンかアカウント ID が設定されていない（docs/04_deployment-procedure.md 3章）
    const error = new Error('ANALYTICS_API_TOKEN か CF_ACCOUNT_ID が無いので集計できない')
    log('error', { msg: error.message, requestId, route: 'scheduled' })
    captureServerError(error, requestId)
  } else {
    try {
      await rollUp({ db, config, now, requestId })
    } catch (error) {
      log('error', { msg: 'analytics rollup failed', requestId, route: 'scheduled', error: errorText(error) })
      captureServerError(error, requestId)
    }
  }
  if (salts !== undefined) {
    const tomorrow = addDays(jstDateOf(now), 1)
    try {
      await prepareSalt(salts, tomorrow)
    } catch (error) {
      log('error', { msg: 'salt preparation failed', requestId, route: 'scheduled', error: errorText(error) })
      captureServerError(error, requestId)
    }
  }
}

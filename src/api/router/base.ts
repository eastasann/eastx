/**
 * 手続きの実装の起点と、実装で共有する小さな部品。
 */

import { env } from 'cloudflare:workers'
import { implement } from '@orpc/server'
import { getDb } from '../../db/client'
import type { Transition } from '../../domain/publishing'
import type { RequestContext } from '../context'
import { contract } from '../contract'
import { log } from '../log'
import { authenticate, authorize, rateLimit } from '../middleware'

/** ミドルウェア（SDD 5.1 の 3〜5）を一律にかけた実装の起点。すべての手続きはここから作る */
export const admin = implement(contract).$context<RequestContext>().use(authenticate).use(rateLimit).use(authorize)

export const db = () => getDb(env)

export function toIso(date: Date): string {
  return date.toISOString()
}

export function toIsoOrNull(date: Date | null): string | null {
  return date === null ? null : date.toISOString()
}

/**
 * 一意制約の違反か。`target` は `テーブル.カラム`（例: `work.slug`）。
 * D1 の例外は Drizzle の例外の原因として包まれて届くので、原因をたどって SQLite の文言を探す。
 */
export function isUniqueViolation(error: unknown, target: string): boolean {
  let current: unknown = error
  while (current instanceof Error) {
    if (current.message.includes(`UNIQUE constraint failed: ${target}`)) return true
    current = current.cause
  }
  return false
}

/** 外部キーの違反か。確かめてから書くまでのあいだに、紐づけ先の行が消えたとき（ADR-006） */
export function isForeignKeyViolation(error: unknown): boolean {
  let current: unknown = error
  while (current instanceof Error) {
    if (current.message.includes('FOREIGN KEY constraint failed')) return true
    current = current.cause
  }
  return false
}

type LogContext = Pick<RequestContext, 'requestId' | 'trace'>

/** 公開・非公開に戻す・削除・アップロードの操作は INFO で残す（runbook 1章） */
export function logOperation(
  context: LogContext,
  msg: 'published' | 'unpublished' | 'deleted' | 'uploaded',
  fields: Record<string, unknown>,
) {
  log('info', { msg, requestId: context.requestId, route: context.trace.route, ...fields })
}

export function logTransition(context: LogContext, transition: Transition, id: string) {
  if (transition === 'publish') logOperation(context, 'published', { id })
  if (transition === 'unpublish') logOperation(context, 'unpublished', { id })
}

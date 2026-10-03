/**
 * 作品とプロジェクトの実装で共有する部品（使用技術の紐づけ）。
 */
import { asc, eq, inArray } from 'drizzle-orm'
import { projectStack, stack, workStack } from '../../db/schema'
import { inputValidationFailed } from '../errors'
import { db } from './base'

type PortfolioKind = 'work' | 'project'

/** 作品・プロジェクトの中での技術の表示順で、紐づいた使用技術を読む */
export async function readLinkedStacks(kind: PortfolioKind, ownerId: string) {
  const d = db()
  const fields = { id: stack.id, key: stack.key, displayName: stack.displayName, iconUrl: stack.iconUrl }
  if (kind === 'work') {
    return d
      .select(fields)
      .from(workStack)
      .innerJoin(stack, eq(workStack.stackId, stack.id))
      .where(eq(workStack.workId, ownerId))
      .orderBy(asc(workStack.sortOrder))
  }
  return d
    .select(fields)
    .from(projectStack)
    .innerJoin(stack, eq(projectStack.stackId, stack.id))
    .where(eq(projectStack.projectId, ownerId))
    .orderBy(asc(projectStack.sortOrder))
}

export function stacksMissing() {
  return inputValidationFailed({ fieldErrors: { stackIds: ['存在しない技術が含まれています'] }, formErrors: [] })
}

/** 存在しない ID が入っていたら INPUT_VALIDATION_FAILED（SDD 5.7） */
export async function assertStacksExist(stackIds: readonly string[]): Promise<void> {
  if (stackIds.length === 0) return
  const rows = await db()
    .select({ id: stack.id })
    .from(stack)
    .where(inArray(stack.id, [...stackIds]))
  if (rows.length !== stackIds.length) throw stacksMissing()
}

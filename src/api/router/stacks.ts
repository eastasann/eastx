import { asc, eq, ne, sql } from 'drizzle-orm'
import { projectStack, stack, workStack } from '../../db/schema'
import { firstAvailable, stackKeyBase } from '../../domain/slug'
import { stackKeyConflict } from '../errors'
import { admin, db, isUniqueViolation, logOperation, toIso } from './base'

type StackRow = typeof stack.$inferSelect

/** 使っている作品とプロジェクトの数の合計（SDD 5.8） */
const usageCount = sql<number>`(
  (select count(*) from ${workStack} where ${workStack.stackId} = ${stack.id})
  + (select count(*) from ${projectStack} where ${projectStack.stackId} = ${stack.id})
)`.mapWith(Number)

function toListItem(row: StackRow, usage: number) {
  return {
    id: row.id,
    key: row.key,
    displayName: row.displayName,
    iconUrl: row.iconUrl,
    linkUrl: row.linkUrl,
    category: row.category,
    isCore: row.isCore,
    showOnTop: row.showOnTop,
    sortOrder: row.sortOrder,
    usageCount: usage,
  }
}

async function readStack(id: string) {
  const row = await db().select({ row: stack, usage: usageCount }).from(stack).where(eq(stack.id, id)).get()
  if (!row) return null
  return { ...toListItem(row.row, row.usage), createdAt: toIso(row.row.createdAt), updatedAt: toIso(row.row.updatedAt) }
}

/** `base` から、ほかの使用技術と重複しない識別名を決める（design-spec 6.7.1） */
async function availableKey(base: string, excludeId?: string): Promise<string> {
  const rows = await db()
    .select({ key: stack.key })
    .from(stack)
    .where(excludeId === undefined ? undefined : ne(stack.id, excludeId))
  const taken = new Set(rows.map((row) => row.key))
  return firstAvailable(base, (candidate) => taken.has(candidate))
}

/** 指定された識別名が使われていれば STACK_KEY_CONFLICT（`suggestion` は次に使える値） */
async function assertKeyAvailable(key: string, excludeId?: string): Promise<void> {
  const suggestion = await availableKey(key, excludeId)
  if (suggestion !== key) throw stackKeyConflict(suggestion)
}

/** 一意インデックスの違反（確かめてから書くまでのあいだの競合）を STACK_KEY_CONFLICT にする（ADR-006） */
async function rethrowKeyConflict(error: unknown, key: string, excludeId?: string): Promise<never> {
  if (isUniqueViolation(error, 'stack.key')) throw stackKeyConflict(await availableKey(key, excludeId))
  throw error
}

export const stacks = {
  list: admin.stacks.list.handler(async () => {
    const rows = await db()
      .select({ row: stack, usage: usageCount })
      .from(stack)
      .orderBy(asc(stack.sortOrder), asc(stack.createdAt))
    return { items: rows.map(({ row, usage }) => toListItem(row, usage)) }
  }),

  create: admin.stacks.create.handler(async ({ input }) => {
    const key = input.key ?? (await availableKey(stackKeyBase(input.displayName)))
    if (input.key !== null) await assertKeyAvailable(input.key)
    let id: string | undefined
    try {
      // 新規作成は末尾に入れる（今の最大値 ＋ 1。SDD 6.1）。最大値は同じ文の中で読む
      const [row] = await db()
        .insert(stack)
        .values({
          key,
          displayName: input.displayName,
          iconUrl: input.iconUrl,
          linkUrl: input.linkUrl,
          category: input.category,
          isCore: input.isCore,
          showOnTop: input.showOnTop,
          sortOrder: sql`(select coalesce(max(${stack.sortOrder}), -1) + 1 from ${stack})`,
        })
        .returning({ id: stack.id })
      id = row?.id
    } catch (e) {
      await rethrowKeyConflict(e, key)
    }
    const result = id === undefined ? null : await readStack(id)
    if (!result) throw new Error('使用技術の作成の直後に行が読めない')
    return result
  }),

  get: admin.stacks.get.handler(async ({ input, errors }) => {
    const result = await readStack(input.params.id)
    if (!result) throw errors.NOT_FOUND()
    return result
  }),

  update: admin.stacks.update.handler(async ({ input: { params, body: input }, errors }) => {
    const d = db()
    const current = await d.select({ id: stack.id }).from(stack).where(eq(stack.id, params.id)).get()
    if (!current) throw errors.NOT_FOUND()
    await assertKeyAvailable(input.key, params.id)
    try {
      await d
        .update(stack)
        .set({
          key: input.key,
          displayName: input.displayName,
          iconUrl: input.iconUrl,
          linkUrl: input.linkUrl,
          category: input.category,
          isCore: input.isCore,
          showOnTop: input.showOnTop,
        })
        .where(eq(stack.id, params.id))
    } catch (e) {
      await rethrowKeyConflict(e, input.key, params.id)
    }
    const result = await readStack(params.id)
    if (!result) throw errors.NOT_FOUND()
    return result
  }),

  remove: admin.stacks.remove.handler(async ({ input, errors, context }) => {
    // work_stack・project_stack の紐づけは ON DELETE CASCADE で外れる
    const [row] = await db().delete(stack).where(eq(stack.id, input.params.id)).returning({ id: stack.id })
    if (!row) throw errors.NOT_FOUND()
    logOperation(context, 'deleted', { id: row.id })
  }),

  reorder: admin.stacks.reorder.handler(async ({ input, errors }) => {
    const d = db()
    const rows = await d.select({ id: stack.id }).from(stack)
    const current = new Set(rows.map((row) => row.id))
    if (rows.length !== input.ids.length || !input.ids.every((id) => current.has(id))) throw errors.ORDER_OUT_OF_DATE()
    const [first, ...rest] = input.ids.map((id, i) =>
      // updated_at に今の値をそのまま入れて、$onUpdateFn で変わらないようにする（SDD 6.1）
      d
        .update(stack)
        .set({ sortOrder: i, updatedAt: sql`${stack.updatedAt}` })
        .where(eq(stack.id, id)),
    )
    if (first) await d.batch([first, ...rest])
    return { ids: input.ids }
  }),
}

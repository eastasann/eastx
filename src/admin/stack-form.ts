/**
 * A7 使用技術の編集ビューのフォームの値と規則（design-spec 6.7.2・6.7.3）
 */
import { z } from 'zod'
import type { stackOutput } from '~/api/contract/stacks'
import { STACK_CATEGORIES } from '~/db/enums'

export type Stack = z.infer<typeof stackOutput>

const stackFormSchema = z.object({
  key: z.string(),
  displayName: z.string(),
  iconUrl: z.string(),
  linkUrl: z.string(),
  category: z.enum(STACK_CATEGORIES),
  isCore: z.boolean(),
  showOnTop: z.boolean(),
})
export type StackForm = z.infer<typeof stackFormSchema>

/** カテゴリと Core を足す前に退避した値は、この2つのキーを持たない */
const backupBeforeCategories = stackFormSchema.omit({ category: true, isCore: true })

/**
 * 退避の中身を今のフォームの形に読み直す。形が合わなければ null。カテゴリと Core のキーが無い退避は、空にできない
 * 欄なので、`loaded`（編集ビューで読み込んだ技術の値。新規作成は初期値）で埋める（design-spec 6.4）
 */
export function parseStackForm(value: unknown, loaded: StackForm): StackForm | null {
  const current = stackFormSchema.safeParse(value)
  if (current.success) return current.data
  if (typeof value === 'object' && value !== null && ('category' in value || 'isCore' in value)) return null
  const before = backupBeforeCategories.safeParse(value)
  return before.success ? { ...before.data, category: loaded.category, isCore: loaded.isCore } : null
}

export function toForm(stack: Stack | null): StackForm {
  if (stack === null) {
    return { key: '', displayName: '', iconUrl: '', linkUrl: '', category: 'tools', isCore: false, showOnTop: true }
  }
  return {
    key: stack.key,
    displayName: stack.displayName,
    iconUrl: stack.iconUrl ?? '',
    linkUrl: stack.linkUrl ?? '',
    category: stack.category,
    isCore: stack.isCore,
    showOnTop: stack.showOnTop,
  }
}

/** 欄のキーの並び（画面の上から。誤りの欄へ移るときの順） */
export const FIELD_ORDER = ['displayName', 'key', 'iconUrl', 'linkUrl', 'category', 'isCore', 'showOnTop']

/** Core を切り替えたあとの値。オンにすると「トップに表示する」もオンにする。オフに戻しても「トップに表示する」はそのまま */
export function withCore(values: StackForm, isCore: boolean): StackForm {
  return { ...values, isCore, showOnTop: isCore ? true : values.showOnTop }
}

/**
 * 「トップに表示する」を押せなくするか。Core でトップに表示しない値（古いコードが作った値・退避の復元）は、
 * 黙って直さずに押せるまま残し、持ち主に決めさせる
 */
export function showOnTopLocked(values: Pick<StackForm, 'isCore' | 'showOnTop'>): boolean {
  return values.isCore && values.showOnTop
}

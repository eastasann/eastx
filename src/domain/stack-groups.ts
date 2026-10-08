/**
 * P1 の Tech Stack の群の分け方（design-spec 6.1.4）。Core の群を先頭に、カテゴリの群を STACK_CATEGORIES の順に並べる
 */
import { STACK_CATEGORIES } from '../db/enums'

export type StackCategory = (typeof STACK_CATEGORIES)[number]
export type StackGroupKey = 'core' | StackCategory

export interface StackGroup<T> {
  key: StackGroupKey
  stacks: T[]
}

/**
 * `stacks` は表示する技術だけを表示順で渡す。Core の技術は Core の群にだけ入れ、カテゴリの群には入れない。
 * 群の中は入力の順のまま。技術の無い群は返さない
 */
export function toStackGroups<T extends { category: StackCategory; isCore: boolean }>(stacks: T[]): StackGroup<T>[] {
  const keys: StackGroupKey[] = ['core', ...STACK_CATEGORIES]
  return keys
    .map((key) => ({
      key,
      stacks: stacks.filter((stack) => (key === 'core' ? stack.isCore : !stack.isCore && stack.category === key)),
    }))
    .filter((group) => group.stacks.length > 0)
}

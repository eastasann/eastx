/**
 * 編集ビューの表示の切り替えの記憶（design-spec 6.7.1）。全種類で共通の1つの値を localStorage に持つ。
 * 管理画面は SSR しない（ssr: false）ので、Cookie にする理由が無い
 */
import { useState } from 'react'

/** L5（作品・プロジェクト・ブログ・コーディング記録） */
export const EDITOR_VIEWS = ['write', 'split', 'bilingual', 'preview'] as const
export type EditorView = (typeof EDITOR_VIEWS)[number]
export const EDITOR_VIEW_KEY = 'eastx:admin:editor-view'

/** L6 のうち日英の項目を持つもの（プロフィール・経歴） */
export const FORM_VIEWS = ['single', 'bilingual'] as const
export type FormView = (typeof FORM_VIEWS)[number]
export const FORM_VIEW_KEY = 'eastx:admin:form-view'

/** 覚えた値。読めない値（無い・手で書き換えられた・ストレージを使えない）は既定 */
export function readView<T extends string>(
  storage: Pick<Storage, 'getItem'> | null,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  try {
    const stored = storage?.getItem(key) ?? null
    return allowed.find((candidate) => candidate === stored) ?? fallback
  } catch {
    return fallback
  }
}

/**
 * 描く表示。幅のせいで使えない表示（モバイルの `split`）は `write` として描くが、覚えた値は書き換えない
 * （幅が戻ったら、覚えた値から描き直す）
 */
export function effectiveEditorView(view: EditorView, mobile: boolean): EditorView {
  return mobile && view === 'split' ? 'write' : view
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** このブラウザに覚えた表示（読めなければ既定） */
export function readStoredView<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  return readView(storage(), key, allowed, fallback)
}

/** 表示を覚える。持ち主が切り替えを押したときだけ呼ぶ */
export function writeStoredView(key: string, value: string): void {
  try {
    storage()?.setItem(key, value)
  } catch {
    // 覚えられなくても、今の画面の切り替えはできる
  }
}

/** 覚えた表示と、持ち主が切り替えたときだけ書く setter */
export function useStoredView<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const [view, setView] = useState(() => readStoredView(key, allowed, fallback))
  return [
    view,
    (next: T) => {
      setView(next)
      writeStoredView(key, next)
    },
  ] as const
}

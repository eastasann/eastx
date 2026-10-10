/**
 * 「言語あり」の判定（design-spec 1.4）。中身ごとに、その言語で表示できるだけの項目が入っているかを見る。
 * 公開側の代替表示（src/content/localize.ts）と、管理画面の言語タブの印・公開のルール（publishing.ts）が共有する。
 */
import type { Lang } from '../i18n/detect'

/**
 * 判定の規則の種類。
 * - `titleAndBody`: ブログ・コーディング記録（タイトルと本文の両方）
 * - `name`: プロフィール（名前）
 * - `title`: 経歴・作品・プロジェクト（タイトル）
 * - `body`: プライバシーのページ（本文）
 */
export type LanguageRule = 'titleAndBody' | 'name' | 'title' | 'body'

/** 言語ごとの入力。空文字は呼び出し側で null にしてから渡す（SDD 5.0） */
export interface LocalizedFields {
  title?: string | null
  body?: string | null
  name?: string | null
}

/** 規則ごとに、言語ありに要る項目 */
export const REQUIRED_FIELDS: Record<LanguageRule, readonly (keyof LocalizedFields)[]> = {
  titleAndBody: ['title', 'body'],
  name: ['name'],
  title: ['title'],
  body: ['body'],
}

export function hasLanguage(rule: LanguageRule, fields: LocalizedFields): boolean {
  return REQUIRED_FIELDS[rule].every((key) => isFilled(fields[key]))
}

export type Languages = Record<Lang, boolean>

export function languagesOf(rule: LanguageRule, ja: LocalizedFields, en: LocalizedFields): Languages {
  return { ja: hasLanguage(rule, ja), en: hasLanguage(rule, en) }
}

export function isFilled(value: string | null | undefined): value is string {
  return value != null && value.trim() !== ''
}

/**
 * プライバシーのページが公開側にあるか（design-spec 6.2.4）。行があり、本文が日英のどちらかにあること。
 * 公開の状態を持たないので、本文の有無だけで決まる。`page` が null なら行が無い
 */
export function hasPrivacyPage(page: Record<Lang, LocalizedFields> | null): boolean {
  if (page === null) return false
  const languages = languagesOf('body', page.ja, page.en)
  return languages.ja || languages.en
}

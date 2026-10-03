/**
 * 言語の代替（design-spec 1.4、SDD 9章）。公開側のサーバー関数が、表示用の形を作るときに使う。
 * - 中身全体: 表示中の言語で「言語あり」ならその言語、なければもう片方の言語で出し、言語ラベル・注記を出す
 * - 項目単位: 出す言語の項目が空なら、その項目だけもう片方の言語の値を出す。どちらも空なら項目ごと出さない
 */
import { hasLanguage, isFilled, type LanguageRule, type LocalizedFields } from '~/domain/languages'
import type { Lang } from '~/i18n/detect'

/** 表示する文字列と、実際に使った言語（代替したときはもう一方の言語） */
export interface LocalizedText {
  value: string
  lang: Lang
}

/** Markdown を描画した HTML と、実際に使った言語 */
export interface LocalizedHtml {
  html: string
  lang: Lang
}

/** 中身全体の言語。fallback が true なら、言語ラベル・注記を出す */
export interface Availability {
  lang: Lang
  fallback: boolean
}

export type Bilingual<T> = Record<Lang, T>

export function otherLang(lang: Lang): Lang {
  return lang === 'ja' ? 'en' : 'ja'
}

/**
 * 中身全体を出す言語。どちらの言語でも「言語あり」でない中身（公開のルールで公開中には起きない）は、表示中の言語のまま
 */
export function availabilityOf(rule: LanguageRule, lang: Lang, fields: Bilingual<LocalizedFields>): Availability {
  if (hasLanguage(rule, fields[lang])) return { lang, fallback: false }
  const other = otherLang(lang)
  if (hasLanguage(rule, fields[other])) return { lang: other, fallback: true }
  return { lang, fallback: false }
}

/** 項目単位の代替表示。`primary` は中身全体を出す言語（`Availability.lang`。プロフィールは表示中の言語） */
export function pickText(primary: Lang, values: Bilingual<string | null>): LocalizedText | null {
  for (const lang of [primary, otherLang(primary)]) {
    const value = values[lang]
    if (isFilled(value)) return { value, lang }
  }
  return null
}

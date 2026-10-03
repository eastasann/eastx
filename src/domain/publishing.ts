/**
 * 公開状態の遷移と、下書き・公開のルール（SDD 5.3、design-spec 6.7.1・6.7.3）。
 * CMS API の保存（src/api/router/）と、管理画面のフォームの補助のチェックが同じ関数を使う。
 */
import type { Lang } from '../i18n/detect'
import { hasLanguage, isFilled, type LanguageRule, type LocalizedFields, REQUIRED_FIELDS } from './languages'

export type Status = 'draft' | 'published'

/** design-spec 6.7.1 のボタンの意味 */
export type Transition = 'saveDraft' | 'publish' | 'update' | 'unpublish'

/** 今の状態（新規作成は null）と、保存後にしたい状態から、操作の意味を決める（SDD 5.3 の表） */
export function transitionOf(current: Status | null, next: Status): Transition {
  if (next === 'draft') return current === 'published' ? 'unpublish' : 'saveDraft'
  return current === 'published' ? 'update' : 'publish'
}

/** 公開・下書きのルールを持つ中身の種類 */
export type PublishableKind = 'career' | 'work' | 'project' | 'blogPost' | 'codingLog'

const LANGUAGE_RULE: Record<PublishableKind, LanguageRule> = {
  career: 'title',
  work: 'title',
  project: 'title',
  blogPost: 'titleAndBody',
  codingLog: 'titleAndBody',
}

/** 下書きのルール: タイトルが日英のどちらかに入っていること（design-spec 6.7.3） */
export function hasAnyTitle(ja: LocalizedFields, en: LocalizedFields): boolean {
  return isFilled(ja.title) || isFilled(en.title)
}

/** 公開に足りない項目。`lang` は言語ごとの項目のときだけ付く（SDD 8章の PUBLISH_REQUIREMENTS_NOT_MET） */
export interface MissingField {
  field: string
  lang?: Lang
}

export interface PublishInput {
  ja: LocalizedFields
  en: LocalizedFields
  slug?: string | null
  startDate?: string | null
}

/**
 * 公開のルール（design-spec 6.7.3）で足りない項目を返す。空なら公開できる。
 * - 少なくとも1つの言語で「言語あり」。どちらもないときは、書きかけの言語（必須の項目が1つでも入っている言語）の
 *   足りない項目を挙げる。どちらも書きかけでなければ両方の言語の項目を挙げる
 * - スラッグ（作品・プロジェクト・ブログ・コーディング記録）、開始年月（経歴・プロジェクト）
 */
export function missingForPublish(kind: PublishableKind, input: PublishInput): MissingField[] {
  const missing: MissingField[] = []
  const rule = LANGUAGE_RULE[kind]
  const langs = { ja: input.ja, en: input.en } as const
  if (!hasLanguage(rule, input.ja) && !hasLanguage(rule, input.en)) {
    const required = REQUIRED_FIELDS[rule]
    const started = (['ja', 'en'] as const).filter((lang) => required.some((key) => isFilled(langs[lang][key])))
    for (const lang of started.length > 0 ? started : (['ja', 'en'] as const)) {
      for (const key of required) {
        if (!isFilled(langs[lang][key])) missing.push({ field: key, lang })
      }
    }
  }
  if (kind !== 'career' && !isFilled(input.slug)) missing.push({ field: 'slug' })
  if ((kind === 'career' || kind === 'project') && !isFilled(input.startDate)) missing.push({ field: 'startDate' })
  return missing
}

/**
 * 作品・プロジェクトの「初めて公開した日時」。一度入れたら変えない（design-spec 6.7.2 の「公開したことがある」の判定）。
 */
export function firstPublishedAtAfterSave(current: Date | null, next: Status, now: Date): Date | null {
  return current ?? (next === 'published' ? now : null)
}

export interface PostDatesInput {
  /** 保存前の状態。新規作成は null */
  current: {
    status: Status
    publishedAt: Date | null
    contentUpdatedAt: Date | null
    ja: LocalizedFields
    en: LocalizedFields
  } | null
  next: {
    status: Status
    /** 本文で受け取った公開日 */
    publishedAt: Date | null
    ja: LocalizedFields
    en: LocalizedFields
  }
  now: Date
}

export type PostDatesResult =
  | { ok: true; publishedAt: Date | null; contentUpdatedAt: Date | null }
  | { ok: false; message: string }

/**
 * ブログ・コーディング記録の公開日と更新日（SDD 5.3・5.9、design-spec 6.7.1・6.7.3）。
 * - 公開日は、一度も公開していないあいだは空だけを受け付け、今より後にはできず、一度公開したら空にできない
 * - 公開日が空のまま公開すると今の日時を入れる。非公開に戻しても消さず、もう一度公開しても変えない
 * - 更新日は、公開中のものを「更新する」で保存し、タイトルか本文（どちらかの言語）が変わったときだけ今の日時にする
 */
export function postDatesAfterSave({ current, next, now }: PostDatesInput): PostDatesResult {
  const everPublished = current?.publishedAt != null
  if (next.publishedAt !== null) {
    if (!everPublished) return { ok: false, message: '公開日は公開した後に入れられます' }
    if (next.publishedAt.getTime() > now.getTime()) return { ok: false, message: '今より後の日時にはできません' }
  } else if (everPublished) {
    return { ok: false, message: '一度公開したものの公開日は空にできません' }
  }

  const publishedAt = next.publishedAt ?? current?.publishedAt ?? (next.status === 'published' ? now : null)
  const transition = transitionOf(current?.status ?? null, next.status)
  const contentChanged =
    current !== null &&
    (['ja', 'en'] as const).some(
      (lang) =>
        (current[lang].title ?? null) !== (next[lang].title ?? null) ||
        (current[lang].body ?? null) !== (next[lang].body ?? null),
    )
  const contentUpdatedAt = transition === 'update' && contentChanged ? now : (current?.contentUpdatedAt ?? null)
  return { ok: true, publishedAt, contentUpdatedAt }
}

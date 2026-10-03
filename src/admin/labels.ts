/**
 * 管理画面の表示の文言（design-spec 6.5〜6.7）。管理画面は日本語だけなので辞書にしない（SDD 9章）
 */
import type { CAREER_KINDS, CODING_LOG_KINDS } from '~/db/schema'
import type { Languages } from '~/domain/languages'
import type { Status } from '~/domain/publishing'

export const STATUS_LABELS: Record<Status, string> = { draft: '下書き', published: '公開' }

export const CAREER_KIND_LABELS: Record<(typeof CAREER_KINDS)[number], string> = { work: '職歴', education: '学歴' }

/** 一覧の「言語」列（design-spec 6.6）。どちらの言語でも言語ありでなければ `—` */
export function languagesLabel(languages: Languages): string {
  if (languages.ja && languages.en) return '日英'
  if (languages.ja) return '日のみ'
  if (languages.en) return '英のみ'
  return '—'
}

/** 一覧・ダッシュボードのタイトル。日本語で出し、なければ英語（design-spec 6.5・6.6） */
export function displayTitle(title: { ja: string | null; en: string | null }): string {
  return title.ja ?? title.en ?? ''
}

/** 管理画面の共通の通知の文言（design-spec 6.6・6.7.4） */
export const NOTICES = {
  saved: '保存しました',
  published: '公開しました',
  updated: '更新しました',
  unpublished: '非公開に戻しました',
  deleted: '削除しました',
  saveFailed: '保存できませんでした。もう一度お試しください',
  deleteFailed: '削除できませんでした',
  reordered: '表示順を保存しました',
  reorderFailed: '表示順を保存できませんでした',
  loadFailed: '読み込めませんでした',
  pageNotFound: 'ページが見つかりませんでした',
  sessionExpired: 'ログインの有効期限が切れました。入力中の内容はこのブラウザに一時保存してあります',
} as const

export const CODING_LOG_KIND_LABELS: Record<(typeof CODING_LOG_KINDS)[number], string> = {
  learning_log: '学習ログ',
  snippet: 'コード断片',
  problem: '問題を解いた記録',
  memo: '技術メモ',
}

/**
 * 公開側が history state で渡す値（SDD 4.1）。
 * - `section`: 言語の切り替えで、トップの表示中のセクションの ID。移ったあとにそこまでスクロールする
 * - `itemId`: 詳細ページの戻るリンクで、元のページングのページを開くための項目の ID
 */
import type { SectionId } from '~/content/site-chrome'

/** トップのセクションの ID（SDD 4.1）。プロフィールはヘッダーのメニューに出ないが、スクロールの位置には使う */
export type TopSectionId = 'profile' | SectionId

declare module '@tanstack/history' {
  interface HistoryState {
    section?: TopSectionId
    itemId?: string
  }
}

/**
 * 公開側が history state で渡す値（SDD 4.1）。
 * - `section`: トップへ移ったあとにスクロールするセクションの ID。言語の切り替え（表示中のセクション）と、詳細ページの戻るリンクが渡す
 * - `itemId`: 詳細ページの戻るリンクで、元のページングのページを開くための項目の ID（`section` のセクションの項目）
 */
import type { SectionId } from '~/content/site-chrome'

/** トップのセクションの ID（SDD 4.1）。プロフィールはヘッダーのメニューに出ないが、スクロールの位置には使う */
export type TopSectionId = 'profile' | SectionId

/** ページングするセクション（design-spec 6.1.3）。使用技術はページングしない */
export type PagedSectionId = Exclude<SectionId, 'stack'>

declare module '@tanstack/history' {
  interface HistoryState {
    section?: TopSectionId
    itemId?: string
  }
}

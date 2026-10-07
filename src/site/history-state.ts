/**
 * 公開側が history state で渡す値（SDD 4.1）。どちらも詳細ページの戻るリンクが渡す。
 * - `section`: トップへ移ったあとにスクロールするセクションの ID
 * - `itemId`: 元のページングのページを開くための項目の ID（`section` のセクションの項目）
 */

/** ページングするセクション（design-spec 6.1.3）。トップのセクションの ID（SDD 4.1）のうち、プロフィールと使用技術を除いたもの */
export type PagedSectionId = 'career' | 'projects' | 'works' | 'blog' | 'coding'

declare module '@tanstack/history' {
  interface HistoryState {
    section?: PagedSectionId
    itemId?: string
  }
}

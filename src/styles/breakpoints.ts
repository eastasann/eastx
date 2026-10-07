/**
 * ブレークポイント（design-spec 4.3）。モバイル <768px ／ タブレット 768〜1023px ／ デスクトップ ≥1024px ／ ワイド ≥1280px。
 * Panda の breakpoints（panda.config.ts）と、CSS だけでは切り替えられない部品のメディアクエリ（src/ui/use-media-query.ts）が使う
 */
export const BREAKPOINTS = { tablet: 768, desktop: 1024, wide: 1280 } as const

import { defineConfig } from '@pandacss/dev'
import { BREAKPOINTS } from './src/styles/breakpoints'
import { semanticTokens, textStyles, tokens } from './src/styles/tokens.generated'

export default defineConfig({
  // preset-panda（既定のテーマ）は入れない。トークンは docs/06_design-tokens.json だけが正（ADR-014）
  presets: ['@pandacss/preset-base'],
  preflight: true,
  include: ['./src/**/*.{ts,tsx}'],
  outdir: 'styled-system',
  strictTokens: true,
  strictPropertyValues: true,
  conditions: {
    extend: {
      // ダークモードは <html data-theme="dark"> で切り替える（ADR-014）
      dark: '[data-theme=dark] &',
      light: '[data-theme=light] &',
    },
  },
  globalCss: {
    html: {
      textStyle: 'body',
      bg: 'bg.canvas',
      color: 'text.default',
      // 固定ヘッダーの下にセクションの見出しが隠れないよう、ハッシュへのスクロールで止める位置を下げる
      scrollPaddingTop: 'token(sizes.header)',
      '&[data-theme=light]': { colorScheme: 'light' },
      '&[data-theme=dark]': { colorScheme: 'dark' },
    },
    // フォーカスの輪は部品ごとに付けず、ここで全体に揃える
    ':focus-visible': { outlineWidth: 'focus-ring', outlineStyle: 'solid', outlineColor: 'focus-ring' },
  },
  theme: {
    breakpoints: { tablet: `${BREAKPOINTS.tablet}px`, desktop: `${BREAKPOINTS.desktop}px` },
    tokens,
    semanticTokens,
    textStyles,
    // ダイアログ・メニューなどの出入りの短いフェード（design-spec 4.4 の「動き」）
    keyframes: {
      'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
      'fade-out': { from: { opacity: 1 }, to: { opacity: 0 } },
    },
  },
})

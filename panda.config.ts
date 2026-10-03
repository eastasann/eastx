import { defineConfig } from '@pandacss/dev'
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
  theme: {
    // design-spec 4.3: モバイル <768px ／ タブレット 768〜1023px ／ デスクトップ ≥1024px
    breakpoints: { tablet: '768px', desktop: '1024px' },
    tokens,
    semanticTokens,
    textStyles,
  },
})

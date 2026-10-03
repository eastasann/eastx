import { describe, expect, it } from 'vitest'
import { buildPandaTheme, flattenTokens, toCssValue, toPandaPath, toPandaRef } from './transform'

describe('flattenTokens', () => {
  it('グループの $type を葉に継承する', () => {
    const leaves = flattenTokens(
      { color: { $type: 'color', neutral: { '0': { $value: { hex: '#fff', components: [1, 1, 1] } } } } },
      ['primitive'],
    )
    expect(leaves).toEqual([
      { path: ['primitive', 'color', 'neutral', '0'], type: 'color', value: { hex: '#fff', components: [1, 1, 1] } },
    ])
  })

  it('$type が決まらない葉は止める', () => {
    expect(() => flattenTokens({ x: { $value: 1 } }, [])).toThrow()
  })
})

describe('toPandaPath', () => {
  it('ADR-014 の対応表のとおりに変換する', () => {
    expect(toPandaPath(['primitive', 'color', 'neutral', '900'])).toEqual(['colors', 'primitive', 'neutral', '900'])
    expect(toPandaPath(['primitive', 'space', '4'])).toEqual(['spacing', 'primitive', '4'])
    expect(toPandaPath(['primitive', 'radius', 'md'])).toEqual(['radii', 'primitive', 'md'])
    expect(toPandaPath(['primitive', 'font', 'family', 'sans'])).toEqual(['fonts', 'primitive', 'sans'])
    expect(toPandaPath(['primitive', 'font', 'letter-spacing', 'wide'])).toEqual([
      'letterSpacings',
      'primitive',
      'wide',
    ])
    expect(toPandaPath(['primitive', 'z', '10'])).toEqual(['zIndex', 'primitive', '10'])
    expect(toPandaPath(['semantic', 'space', 'gutter'])).toEqual(['spacing', 'gutter'])
    expect(toPandaPath(['semantic', 'z-index', 'toast'])).toEqual(['zIndex', 'toast'])
    expect(toPandaPath(['semantic', 'aspect-ratio', 'thumbnail'])).toEqual(['aspectRatios', 'thumbnail'])
  })
})

describe('toCssValue', () => {
  it('色は hex、alpha 付きは rgba にする', () => {
    expect(toCssValue('color', { hex: '#ffffff', components: [1, 1, 1] })).toBe('#ffffff')
    expect(toCssValue('color', { hex: '#000000', components: [0, 0, 0], alpha: 0.15 })).toBe('rgba(0, 0, 0, 0.15)')
  })

  it('dimension と duration は値と単位をつなぐ', () => {
    expect(toCssValue('dimension', { value: 16, unit: 'px' })).toBe('16px')
    expect(toCssValue('duration', { value: 220, unit: 'ms' })).toBe('220ms')
  })

  it('fontFamily は空白を含む名前だけ引用する', () => {
    expect(toCssValue('fontFamily', ['Inter Variable', 'sans-serif'])).toBe("'Inter Variable', sans-serif")
  })

  it('cubicBezier は cubic-bezier() にする', () => {
    expect(toCssValue('cubicBezier', [0.2, 0, 0, 1])).toBe('cubic-bezier(0.2, 0, 0, 1)')
  })

  it('参照は Panda の参照に変換する', () => {
    expect(toCssValue('color', '{primitive.color.neutral.0}')).toBe('{colors.primitive.neutral.0}')
    expect(toPandaRef('{primitive.duration.normal}')).toBe('{durations.primitive.normal}')
  })
})

describe('buildPandaTheme', () => {
  const doc = {
    primitive: {
      color: {
        $type: 'color',
        neutral: {
          '0': { $value: { hex: '#ffffff', components: [1, 1, 1] } },
          '950': { $value: { hex: '#0a0a0a', components: [0.04, 0.04, 0.04] } },
        },
      },
      space: { $type: 'dimension', '4': { $value: { value: 16, unit: 'px' } } },
      font: {
        family: { $type: 'fontFamily', sans: { $value: ['Arial'] } },
        size: { $type: 'dimension', md: { $value: { value: 1, unit: 'rem' } } },
        weight: { $type: 'fontWeight', regular: { $value: 400 } },
        'letter-spacing': { $type: 'dimension', normal: { $value: { value: 0, unit: 'rem' } } },
      },
      duration: {
        $type: 'duration',
        instant: { $value: { value: 0, unit: 'ms' } },
        normal: { $value: { value: 220, unit: 'ms' } },
      },
      easing: { $type: 'cubicBezier', standard: { $value: [0.2, 0, 0, 1] } },
    },
    semantic: {
      color: {
        $type: 'color',
        light: { bg: { canvas: { $value: '{primitive.color.neutral.0}' } } },
        dark: { bg: { canvas: { $value: '{primitive.color.neutral.950}' } } },
      },
      space: { $type: 'dimension', gutter: { $value: '{primitive.space.4}' } },
      typography: {
        $type: 'typography',
        body: {
          $value: {
            fontFamily: '{primitive.font.family.sans}',
            fontSize: '{primitive.font.size.md}',
            fontWeight: '{primitive.font.weight.regular}',
            letterSpacing: '{primitive.font.letter-spacing.normal}',
            lineHeight: 1.8,
          },
        },
      },
      motion: {
        $type: 'transition',
        paging: {
          $value: {
            duration: '{primitive.duration.normal}',
            delay: '{primitive.duration.instant}',
            timingFunction: '{primitive.easing.standard}',
          },
        },
      },
    },
  }

  it('プリミティブを primitive 名前空間に、セマンティックをそのままの名前に出す', () => {
    const theme = buildPandaTheme(doc)
    expect(theme.tokens).toMatchObject({
      colors: { primitive: { neutral: { '0': { value: '#ffffff' } } } },
      spacing: { primitive: { '4': { value: '16px' } } },
    })
    expect(theme.semanticTokens).toMatchObject({
      spacing: { gutter: { value: '{spacing.primitive.4}' } },
    })
  })

  it('semantic.color は light/dark を base/_dark にまとめる', () => {
    const theme = buildPandaTheme(doc)
    expect(theme.semanticTokens).toMatchObject({
      colors: {
        bg: { canvas: { value: { base: '{colors.primitive.neutral.0}', _dark: '{colors.primitive.neutral.950}' } } },
      },
    })
  })

  it('typography は参照を解決して textStyles に出す', () => {
    const theme = buildPandaTheme(doc)
    expect(theme.textStyles).toMatchObject({
      body: {
        value: { fontFamily: 'Arial', fontSize: '1rem', fontWeight: '400', letterSpacing: '0rem', lineHeight: 1.8 },
      },
    })
  })

  it('motion は durations と easings の組に展開する', () => {
    const theme = buildPandaTheme(doc)
    expect(theme.semanticTokens).toMatchObject({
      durations: { motion: { paging: { value: '{durations.primitive.normal}' } } },
      easings: { motion: { paging: { value: '{easings.primitive.standard}' } } },
    })
  })

  it('light と dark が対になっていなければ止める', () => {
    const broken = structuredClone(doc)
    delete (broken.semantic.color.dark.bg as Record<string, unknown>).canvas
    expect(() => buildPandaTheme(broken)).toThrow()
  })
})

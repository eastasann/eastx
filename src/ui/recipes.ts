/**
 * ボタン・入力欄・チップ・ラベル・カードのレシピ（design-spec 4.4、ADR-014）。
 * 値はデザイントークンのセマンティック層だけで指定する。フォーカスの輪は panda.config.ts の globalCss で全体に付ける。
 */
import { cva } from 'styled-system/css'

export const button = cva({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'inline',
    flexShrink: 0,
    h: 'control',
    px: 'inset',
    textStyle: 'ui',
    whiteSpace: 'nowrap',
    borderRadius: 'control',
    borderWidth: 'default',
    borderStyle: 'solid',
    borderColor: 'transparent',
    cursor: 'pointer',
    transitionProperty: 'background-color, border-color, color',
    transitionDuration: 'motion.hover',
    transitionTimingFunction: 'motion.hover',
    _disabled: { opacity: 'disabled', cursor: 'not-allowed' },
  },
  variants: {
    variant: {
      /** 画面で一番の操作。アクセントは操作できる場所だけに使う（design-spec 4.4） */
      solid: {
        bg: 'accent.default',
        color: 'text.on-accent',
        _hover: { bg: 'accent.hover' },
        _disabled: { _hover: { bg: 'accent.default' } },
      },
      outline: {
        bg: 'surface.default',
        color: 'text.default',
        borderColor: 'border.strong',
        _hover: { bg: 'bg.subtle' },
        _disabled: { _hover: { bg: 'surface.default' } },
      },
      ghost: {
        color: 'text.default',
        _hover: { bg: 'bg.muted' },
        _disabled: { _hover: { bg: 'transparent' } },
      },
      danger: {
        bg: 'danger.default',
        color: 'text.on-accent',
        _disabled: { _hover: { bg: 'danger.default' } },
      },
    },
    shape: {
      default: {},
      /** アイコンだけのボタン。読み上げ名は aria-label で付ける */
      icon: { w: 'control', px: 'none' },
    },
  },
  defaultVariants: { variant: 'solid', shape: 'default' },
})

export const input = cva({
  base: {
    display: 'block',
    h: 'control',
    px: 'inset-dense',
    textStyle: 'ui',
    color: 'text.default',
    bg: 'surface.default',
    borderWidth: 'default',
    borderStyle: 'solid',
    borderColor: 'border.default',
    borderRadius: 'control',
    _placeholder: { color: 'text.muted' },
    _hover: { borderColor: 'border.strong' },
    _invalid: { borderColor: 'danger.default' },
    _disabled: { opacity: 'disabled', cursor: 'not-allowed' },
  },
  variants: {
    multiline: {
      false: {},
      true: { h: 'auto', py: 'inset-dense', textStyle: 'body-sm', resize: 'vertical' },
    },
  },
  defaultVariants: { multiline: false },
})

/** 使用技術のチップ。リンクのときは押せる見た目にする */
export const chip = cva({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'inline',
    py: 'inset-dense',
    px: 'inset',
    textStyle: 'label',
    color: 'text.default',
    bg: 'surface.default',
    borderWidth: 'default',
    borderStyle: 'solid',
    borderColor: 'border.default',
    borderRadius: 'chip',
  },
  variants: {
    interactive: {
      false: {},
      true: {
        cursor: 'pointer',
        transitionProperty: 'border-color, color',
        transitionDuration: 'motion.hover',
        transitionTimingFunction: 'motion.hover',
        _hover: { borderColor: 'accent.default', color: 'accent.default' },
      },
    },
  },
  defaultVariants: { interactive: false },
})

/** 言語ラベル（「英語のみ」）・種類ラベル・状態（下書き・公開中）など、押せない小さな札 */
export const label = cva({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    px: 'inset-dense',
    textStyle: 'label',
    whiteSpace: 'nowrap',
    borderRadius: 'chip',
  },
  variants: {
    tone: {
      neutral: { bg: 'bg.muted', color: 'text.muted' },
      accent: { bg: 'accent.subtle', color: 'accent.default' },
      danger: { bg: 'danger.subtle', color: 'danger.default' },
    },
  },
  defaultVariants: { tone: 'neutral' },
})

/** カードは影ではなく枠線で区切る（design-spec 4.4） */
export const card = cva({
  base: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'stack-dense',
    p: 'inset',
    bg: 'surface.default',
    borderWidth: 'default',
    borderStyle: 'solid',
    borderColor: 'border.default',
    borderRadius: 'card',
  },
  variants: {
    interactive: {
      false: {},
      true: {
        transitionProperty: 'border-color',
        transitionDuration: 'motion.hover',
        transitionTimingFunction: 'motion.hover',
        _hover: { borderColor: 'border.strong' },
      },
    },
  },
  defaultVariants: { interactive: false },
})

/** 浮いている部品（メニュー・ダイアログ・セレクト・コンボボックス・ツールチップ・トースト）の面 */
export const overlaySurface = cva({
  base: {
    bg: 'surface.raised',
    color: 'text.default',
    borderWidth: 'default',
    borderStyle: 'solid',
    borderColor: 'border.default',
    boxShadow: 'overlay',
    zIndex: 'overlay',
  },
  variants: {
    /** 画面の端に付ける引き出しは角を丸めない */
    rounded: { true: { borderRadius: 'card' }, false: {} },
  },
  defaultVariants: { rounded: true },
})

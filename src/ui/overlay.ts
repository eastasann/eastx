import { css } from 'styled-system/css'

/**
 * Ark UI の部品が付ける data-state（open・closed）に合わせた、出入りのフェード。
 * 閉じるときのフェードは、Ark UI が閉じのアニメーションの終わりを待ってから外すので見える
 */
export const fade = css({
  _open: {
    animationName: 'fade-in',
    animationDuration: 'motion.overlay',
    animationTimingFunction: 'motion.overlay',
  },
  _closed: {
    animationName: 'fade-out',
    animationDuration: 'motion.overlay',
    animationTimingFunction: 'motion.overlay',
  },
})

/** 選択肢の1行（メニュー・セレクト・コンボボックスで共通）。キーボードで選んでいる行は data-highlighted */
export const optionItem = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'inline',
  minH: 'control',
  px: 'inset-dense',
  textStyle: 'ui',
  color: 'text.default',
  borderRadius: 'control',
  cursor: 'pointer',
  textDecoration: 'none',
  _highlighted: { bg: 'bg.muted' },
  _disabled: { opacity: 'disabled', cursor: 'not-allowed' },
  '&[aria-current=page]': { color: 'accent.default' },
})

/** 浮いた一覧の内側 */
export const optionList = css({
  display: 'flex',
  flexDirection: 'column',
  p: 'inset-dense',
  minW: 'popover',
  outline: 'none',
})

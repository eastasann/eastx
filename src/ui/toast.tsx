/**
 * トースト（Ark UI の Toast に見た目を付けたもの）。`toaster.create({ title, type })` で出す。
 * 出す場所の <Toaster /> は管理画面のレイアウトに1つだけ置く（公開側はトーストを使わない）
 */
import { Toaster as ArkToaster, createToaster, Toast } from '@ark-ui/react/toast'
import { css, cx } from 'styled-system/css'
import { CloseIcon } from './icons'
import { button } from './recipes'

export const toaster = createToaster({ placement: 'bottom-end', overlap: false })

const root = css({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 'inline',
  minW: 'popover',
  maxW: 'content',
  p: 'inset',
  bg: 'surface.raised',
  color: 'text.default',
  borderWidth: 'default',
  borderStyle: 'solid',
  borderColor: 'border.default',
  borderRadius: 'card',
  boxShadow: 'overlay',
  // Ark UI が積み重ねの位置・高さ・重なりの順を CSS 変数で渡す
  translate: 'var(--x) var(--y)',
  scale: 'var(--scale)',
  zIndex: 'var(--z-index)',
  height: 'var(--height)',
  opacity: 'var(--opacity)',
  willChange: 'translate, opacity, scale',
  transitionProperty: 'translate, scale, opacity, height',
  transitionDuration: 'motion.overlay',
  transitionTimingFunction: 'motion.overlay',
})

const tone = {
  error: css({ borderLeftColor: 'danger.default', borderLeftWidth: 'emphasis' }),
  success: css({ borderLeftColor: 'success.default', borderLeftWidth: 'emphasis' }),
  warning: css({ borderLeftColor: 'warning.default', borderLeftWidth: 'emphasis' }),
} as const

export function Toaster() {
  return (
    <ArkToaster toaster={toaster}>
      {(toast) => (
        <Toast.Root
          className={cx(root, toast.type !== undefined && toast.type in tone && tone[toast.type as keyof typeof tone])}
        >
          <div className={css({ display: 'flex', flexDirection: 'column', gap: 'inline', flex: '1' })}>
            <Toast.Title className={css({ textStyle: 'ui' })}>{toast.title}</Toast.Title>
            {toast.description !== undefined && (
              <Toast.Description className={css({ textStyle: 'body-sm', color: 'text.muted' })}>
                {toast.description}
              </Toast.Description>
            )}
          </div>
          <Toast.CloseTrigger aria-label="閉じる" className={button({ variant: 'ghost', shape: 'icon' })}>
            <CloseIcon size="sm" />
          </Toast.CloseTrigger>
        </Toast.Root>
      )}
    </ArkToaster>
  )
}

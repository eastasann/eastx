/**
 * ダイアログ（Ark UI の Dialog に見た目を付けたもの）。フォーカスの閉じ込め・Esc で閉じる・背景のスクロールの停止は Ark UI が持つ。
 * `placement: 'start'` は画面の左端から出す引き出しで、モバイル幅のメニュー（公開側のヘッダー・管理画面のサイドメニュー）に使う
 */
import { Dialog as ArkDialog } from '@ark-ui/react/dialog'
import { Portal } from '@ark-ui/react/portal'
import type { ReactNode } from 'react'
import { css, cva, cx } from 'styled-system/css'
import { CloseIcon } from './icons'
import { fade } from './overlay'
import { button, overlaySurface } from './recipes'

const backdrop = css({ position: 'fixed', inset: 'none', bg: 'overlay', zIndex: 'overlay' })

const positioner = cva({
  base: { position: 'fixed', inset: 'none', zIndex: 'overlay', display: 'flex' },
  variants: {
    placement: {
      center: { alignItems: 'center', justifyContent: 'center', p: 'gutter' },
      start: { alignItems: 'stretch', justifyContent: 'flex-start' },
    },
  },
})

const content = cva({
  base: { display: 'flex', flexDirection: 'column', gap: 'stack-dense', p: 'inset', overflowY: 'auto' },
  variants: {
    placement: {
      center: { maxW: 'content', maxH: 'dvh' },
      start: { w: 'sidebar' },
    },
  },
})

const header = css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'inline' })

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** 見出しを見た目では出さない（引き出しのメニューなど、中身が見出しを兼ねるとき）。読み上げ名には使う */
  hideTitle?: boolean
  description?: ReactNode
  /** 閉じるボタンの読み上げ名（公開側は表示中の言語で渡す） */
  closeLabel: string
  placement?: 'center' | 'start'
  children: ReactNode
}

export function Dialog({
  open,
  onOpenChange,
  title,
  hideTitle = false,
  description,
  closeLabel,
  placement = 'center',
  children,
}: DialogProps) {
  return (
    <ArkDialog.Root open={open} onOpenChange={(details) => onOpenChange(details.open)} lazyMount unmountOnExit>
      <Portal>
        <ArkDialog.Backdrop className={cx(backdrop, fade)} />
        <ArkDialog.Positioner className={positioner({ placement })}>
          <ArkDialog.Content
            className={cx(overlaySurface({ rounded: placement === 'center' }), content({ placement }), fade)}
          >
            <div className={header}>
              <ArkDialog.Title className={hideTitle ? css({ srOnly: true }) : css({ textStyle: 'heading-3' })}>
                {title}
              </ArkDialog.Title>
              <ArkDialog.CloseTrigger
                aria-label={closeLabel}
                className={cx(button({ variant: 'ghost', shape: 'icon' }), css({ ml: 'auto' }))}
              >
                <CloseIcon />
              </ArkDialog.CloseTrigger>
            </div>
            {description !== undefined && (
              <ArkDialog.Description className={css({ textStyle: 'body-sm', color: 'text.muted' })}>
                {description}
              </ArkDialog.Description>
            )}
            {children}
          </ArkDialog.Content>
        </ArkDialog.Positioner>
      </Portal>
    </ArkDialog.Root>
  )
}

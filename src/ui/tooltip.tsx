/**
 * ツールチップ（Ark UI の Tooltip に見た目を付けたもの）。タブレット幅でアイコンだけにした管理画面のサイドメニューの項目名など、
 * 見た目に出ていない名前を補う。読み上げ名は中身の側（aria-label など）で持ち、ツールチップには頼らない
 */
import { Portal } from '@ark-ui/react/portal'
import { Tooltip as ArkTooltip } from '@ark-ui/react/tooltip'
import type { ReactNode } from 'react'
import { css, cx } from 'styled-system/css'
import { fade } from './overlay'
import { overlaySurface } from './recipes'

export interface TooltipProps {
  content: ReactNode
  children: ReactNode
  placement?: 'top' | 'right' | 'bottom' | 'left'
  /** false のときはツールチップを出さず、中身だけを描く */
  enabled?: boolean
}

export function Tooltip({ content, children, placement = 'top', enabled = true }: TooltipProps) {
  if (!enabled) return children
  return (
    <ArkTooltip.Root positioning={{ placement }} lazyMount unmountOnExit>
      <ArkTooltip.Trigger asChild>{children}</ArkTooltip.Trigger>
      <Portal>
        <ArkTooltip.Positioner>
          <ArkTooltip.Content
            className={cx(
              overlaySurface(),
              fade,
              css({ px: 'inset-dense', textStyle: 'label', pointerEvents: 'none', maxW: 'popover' }),
            )}
          >
            {content}
          </ArkTooltip.Content>
        </ArkTooltip.Positioner>
      </Portal>
    </ArkTooltip.Root>
  )
}

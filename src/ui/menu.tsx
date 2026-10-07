/**
 * メニュー（Ark UI の Menu に見た目を付けたもの）。矢印キーでの移動・文字での先頭一致・Esc で閉じるは Ark UI が持つ。
 * 項目は `onSelect` で操作を受けるか、`href` でリンクにする（リンクは Ark UI の asChild で <a> に描く）
 */
import { Menu as ArkMenu } from '@ark-ui/react/menu'
import { Portal } from '@ark-ui/react/portal'
import type { ReactNode } from 'react'
import { cx } from 'styled-system/css'
import { fade, optionItem, optionList } from './overlay'
import { overlaySurface } from './recipes'

export interface MenuItem {
  value: string
  label: ReactNode
  href?: string
  /** リンクを別タブで開く（公開サイトで見る） */
  external?: boolean
  /** 今いる場所の項目に付ける */
  current?: boolean
  disabled?: boolean
}

export interface MenuProps {
  trigger: ReactNode
  triggerClassName?: string
  /** 開くボタンの読み上げ名（中身がアイコンだけのとき） */
  triggerLabel?: string
  items: MenuItem[]
  onSelect?: (value: string) => void
}

export function Menu({ trigger, triggerClassName, triggerLabel, items, onSelect }: MenuProps) {
  return (
    <ArkMenu.Root onSelect={(details) => onSelect?.(details.value)} lazyMount unmountOnExit>
      <ArkMenu.Trigger className={triggerClassName} aria-label={triggerLabel}>
        {trigger}
      </ArkMenu.Trigger>
      <Portal>
        <ArkMenu.Positioner>
          <ArkMenu.Content className={cx(overlaySurface(), optionList, fade)}>
            {items.map((item) =>
              item.href === undefined ? (
                <ArkMenu.Item key={item.value} value={item.value} disabled={item.disabled} className={optionItem}>
                  {item.label}
                </ArkMenu.Item>
              ) : (
                <ArkMenu.Item key={item.value} value={item.value} disabled={item.disabled} asChild>
                  <a
                    href={item.href}
                    target={item.external ? '_blank' : undefined}
                    rel={item.external ? 'noopener noreferrer' : undefined}
                    aria-current={item.current ? 'page' : undefined}
                    className={optionItem}
                  >
                    {item.label}
                  </a>
                </ArkMenu.Item>
              ),
            )}
          </ArkMenu.Content>
        </ArkMenu.Positioner>
      </Portal>
    </ArkMenu.Root>
  )
}

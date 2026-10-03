/**
 * タブ（Ark UI の Tabs に見た目を付けたもの）。矢印キーでの移動と、タブとパネルの関連付けは Ark UI が持つ。
 * 管理画面の言語タブ（6.7）に使う
 */
import { Tabs as ArkTabs } from '@ark-ui/react/tabs'
import type { ReactNode } from 'react'
import { css } from 'styled-system/css'

export interface TabItem {
  value: string
  label: ReactNode
  content: ReactNode
}

export interface TabsProps {
  items: TabItem[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  /** タブの並びの読み上げ名 */
  label: string
  className?: string
}

const list = css({
  display: 'flex',
  gap: 'inline',
  borderBottomWidth: 'default',
  borderBottomStyle: 'solid',
  borderBottomColor: 'border.default',
})

const trigger = css({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'inline',
  h: 'control',
  px: 'inset-dense',
  textStyle: 'ui',
  color: 'text.muted',
  cursor: 'pointer',
  // 選んでいるタブの下線は、並びの下線に重ねる
  borderBottomWidth: 'emphasis',
  borderBottomStyle: 'solid',
  borderBottomColor: 'transparent',
  _hover: { color: 'text.default' },
  _selected: { color: 'accent.default', borderBottomColor: 'accent.default' },
  _disabled: { opacity: 'disabled', cursor: 'not-allowed' },
})

const content = css({ pt: 'stack-dense', outline: 'none' })

export function Tabs({ items, value, defaultValue, onValueChange, label, className }: TabsProps) {
  return (
    <ArkTabs.Root
      value={value}
      defaultValue={defaultValue ?? items[0]?.value}
      onValueChange={(details) => onValueChange?.(details.value)}
      className={className}
    >
      <ArkTabs.List aria-label={label} className={list}>
        {items.map((item) => (
          <ArkTabs.Trigger key={item.value} value={item.value} className={trigger}>
            {item.label}
          </ArkTabs.Trigger>
        ))}
      </ArkTabs.List>
      {items.map((item) => (
        <ArkTabs.Content key={item.value} value={item.value} className={content}>
          {item.content}
        </ArkTabs.Content>
      ))}
    </ArkTabs.Root>
  )
}

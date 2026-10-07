/**
 * 表示の切り替え（Ark UI の SegmentGroup に見た目を付けたもの）。1つだけを選ぶラジオのグループで、矢印キーでの移動は
 * Ark UI が持つ。管理画面の編集ビューの「書く｜並べる｜日英｜プレビュー」「片方｜日英」（design-spec 6.7.1）に使う
 */
import { SegmentGroup as ArkSegmentGroup } from '@ark-ui/react/segment-group'
import type { ComponentType } from 'react'
import { css } from 'styled-system/css'
import { Tooltip } from './tooltip'

export interface SegmentItem<T extends string> {
  value: T
  label: string
  /**
   * 渡すと、見た目はアイコンだけにする。名前はホバー・フォーカスでツールチップに出し、読み上げの名前にも使う
   */
  icon?: ComponentType<{ size?: 'md' | 'sm' }>
}

export interface SegmentGroupProps<T extends string> {
  /** グループの読み上げ名 */
  label: string
  items: readonly SegmentItem<T>[]
  value: T
  onValueChange: (value: T) => void
}

const root = css({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'inline-tight',
  p: 'inline-tight',
  borderWidth: 'default',
  borderStyle: 'solid',
  borderColor: 'border.default',
  borderRadius: 'control',
})

const item = css({
  display: 'inline-flex',
  alignItems: 'center',
  px: 'inset-dense',
  py: 'inline-tight',
  textStyle: 'ui',
  color: 'text.muted',
  whiteSpace: 'nowrap',
  borderRadius: 'control',
  cursor: 'pointer',
  transitionProperty: 'background-color, color',
  transitionDuration: 'motion.hover',
  transitionTimingFunction: 'motion.hover',
  _hover: { color: 'text.default' },
  _checked: { color: 'text.default', bg: 'bg.muted' },
  // フォーカスの輪は隠したラジオではなく見える項目に出す
  '&[data-focus-visible]': { outlineWidth: 'focus-ring', outlineStyle: 'solid', outlineColor: 'focus-ring' },
})

export function SegmentGroup<T extends string>({ label, items, value, onValueChange }: SegmentGroupProps<T>) {
  return (
    <ArkSegmentGroup.Root
      value={value}
      onValueChange={(details) => {
        const next = items.find((candidate) => candidate.value === details.value)
        if (next) onValueChange(next.value)
      }}
      aria-label={label}
      className={root}
    >
      {items.map((segment) => {
        const Icon = segment.icon
        return (
          // ツールチップの引き金は項目を包む別の要素にする。項目そのものに付けると、ツールチップの id・data-state が
          // 項目のもの（選んでいる印の data-state=checked）を上書きする
          <Tooltip key={segment.value} content={segment.label} placement="bottom" enabled={Icon !== undefined}>
            <span className={css({ display: 'inline-flex' })}>
              <ArkSegmentGroup.Item value={segment.value} className={item}>
                {Icon !== undefined && <Icon size="sm" />}
                <ArkSegmentGroup.ItemText className={Icon === undefined ? undefined : css({ srOnly: true })}>
                  {segment.label}
                </ArkSegmentGroup.ItemText>
                <ArkSegmentGroup.ItemControl />
                <ArkSegmentGroup.ItemHiddenInput />
              </ArkSegmentGroup.Item>
            </span>
          </Tooltip>
        )
      })}
    </ArkSegmentGroup.Root>
  )
}

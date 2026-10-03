/**
 * セレクト（Ark UI の Select に見た目を付けたもの）。一覧の絞り込み（状態・種類）とフォームの選択に使う。
 * フォームの送信と自動入力のために、隠した <select> も出す
 */
import { Portal } from '@ark-ui/react/portal'
import { Select as ArkSelect, createListCollection } from '@ark-ui/react/select'
import { useMemo } from 'react'
import { css, cx } from 'styled-system/css'
import { CheckIcon, ChevronDownIcon } from './icons'
import { fade, optionItem, optionList } from './overlay'
import { input, overlaySurface } from './recipes'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps {
  label: string
  /** ラベルを見た目では出さない（操作バーの絞り込みなど）。読み上げ名には使う */
  hideLabel?: boolean
  options: SelectOption[]
  value: string | null
  onValueChange: (value: string | null) => void
  placeholder?: string
  name?: string
  disabled?: boolean
  invalid?: boolean
}

// input の display を上書きするので、クラスを cx で並べず1つの css にまとめる
// （同じプロパティのクラスは、並べた順ではなくスタイルシートの順で勝ち負けが決まる）
const trigger = css(input.raw(), {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'inline',
  cursor: 'pointer',
  textAlign: 'start',
})

export function Select({
  label,
  hideLabel = false,
  options,
  value,
  onValueChange,
  placeholder,
  name,
  disabled,
  invalid,
}: SelectProps) {
  const collection = useMemo(() => createListCollection({ items: options }), [options])
  return (
    <ArkSelect.Root
      collection={collection}
      value={value === null ? [] : [value]}
      onValueChange={(details) => onValueChange(details.value[0] ?? null)}
      name={name}
      disabled={disabled}
      invalid={invalid}
      positioning={{ sameWidth: true }}
      lazyMount
      unmountOnExit
      className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}
    >
      <ArkSelect.Label className={hideLabel ? css({ srOnly: true }) : css({ textStyle: 'label' })}>
        {label}
      </ArkSelect.Label>
      <ArkSelect.Control>
        <ArkSelect.Trigger className={trigger}>
          <ArkSelect.ValueText placeholder={placeholder} />
          <ArkSelect.Indicator className={css({ color: 'text.muted', display: 'flex' })}>
            <ChevronDownIcon size="sm" />
          </ArkSelect.Indicator>
        </ArkSelect.Trigger>
      </ArkSelect.Control>
      <Portal>
        <ArkSelect.Positioner>
          <ArkSelect.Content className={cx(overlaySurface(), optionList, fade)}>
            {collection.items.map((option) => (
              <ArkSelect.Item key={option.value} item={option} className={optionItem}>
                <ArkSelect.ItemText>{option.label}</ArkSelect.ItemText>
                <ArkSelect.ItemIndicator className={css({ display: 'flex', color: 'accent.default' })}>
                  <CheckIcon size="sm" />
                </ArkSelect.ItemIndicator>
              </ArkSelect.Item>
            ))}
          </ArkSelect.Content>
        </ArkSelect.Positioner>
      </Portal>
      <ArkSelect.HiddenSelect />
    </ArkSelect.Root>
  )
}

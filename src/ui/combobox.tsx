/**
 * コンボボックス（Ark UI の Combobox に見た目を付けたもの）。入力した文字で候補を絞り、矢印キーと Enter で選ぶ。
 * 作品・プロジェクトの使用技術を選ぶ欄（6.7.2）に使う。絞り込みは表示名の部分一致で、大文字小文字を区別しない
 */
import { Combobox as ArkCombobox, useListCollection } from '@ark-ui/react/combobox'
import { Portal } from '@ark-ui/react/portal'
import { useEffect } from 'react'
import { css, cx } from 'styled-system/css'
import { CheckIcon } from './icons'
import { fade, optionItem, optionList } from './overlay'
import { input, overlaySurface } from './recipes'

export interface ComboboxOption {
  value: string
  label: string
}

export interface ComboboxProps {
  label: string
  options: ComboboxOption[]
  value: string[]
  onValueChange: (value: string[]) => void
  multiple?: boolean
  placeholder?: string
  emptyText: string
  disabled?: boolean
  invalid?: boolean
}

function includesText(itemText: string, filterText: string): boolean {
  return itemText.toLocaleLowerCase().includes(filterText.toLocaleLowerCase())
}

export function Combobox({
  label,
  options,
  value,
  onValueChange,
  multiple = false,
  placeholder,
  emptyText,
  disabled,
  invalid,
}: ComboboxProps) {
  const { collection, filter, set } = useListCollection({ initialItems: options, filter: includesText })

  // 候補が変わったら（使用技術を追加したあとなど）入れ直す
  useEffect(() => {
    set(options)
  }, [options, set])

  return (
    <ArkCombobox.Root
      collection={collection}
      value={value}
      onValueChange={(details) => onValueChange(details.value)}
      onInputValueChange={(details) => filter(details.inputValue)}
      multiple={multiple}
      disabled={disabled}
      invalid={invalid}
      openOnClick
      positioning={{ sameWidth: true }}
      lazyMount
      unmountOnExit
      className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}
    >
      <ArkCombobox.Label className={css({ textStyle: 'label' })}>{label}</ArkCombobox.Label>
      <ArkCombobox.Control>
        <ArkCombobox.Input placeholder={placeholder} className={input()} />
      </ArkCombobox.Control>
      <Portal>
        <ArkCombobox.Positioner>
          <ArkCombobox.Content className={cx(overlaySurface(), optionList, fade)}>
            <ArkCombobox.Empty className={css({ px: 'inset-dense', textStyle: 'body-sm', color: 'text.muted' })}>
              {emptyText}
            </ArkCombobox.Empty>
            {collection.items.map((option) => (
              <ArkCombobox.Item key={option.value} item={option} className={optionItem}>
                <ArkCombobox.ItemText>{option.label}</ArkCombobox.ItemText>
                <ArkCombobox.ItemIndicator className={css({ display: 'flex', color: 'accent.default' })}>
                  <CheckIcon size="sm" />
                </ArkCombobox.ItemIndicator>
              </ArkCombobox.Item>
            ))}
          </ArkCombobox.Content>
        </ArkCombobox.Positioner>
      </Portal>
    </ArkCombobox.Root>
  )
}

/**
 * 候補から選んで追加するコンボボックス（Ark UI の Combobox に見た目を付けたもの）。入力した文字で候補を絞り、
 * 矢印キーと Enter で選ぶ。選ぶと入力を空に戻す（選んだものは呼び出し側が欄の外に並べる）。
 * `keepOpen` なら選んでも一覧を閉じず、続けて選べる。`selectedValues` の候補には ✓ を付ける（もう一度選ぶと外すのは呼び出し側）。
 * 作品・プロジェクトの使用技術を選ぶ欄（design-spec 6.7.1）に使う。絞り込みは表示名の部分一致で、大文字小文字を区別しない。
 * `onCreate` を渡すと、入力と同じ名前の候補がないとき、末尾に「新しく作る」候補を出す
 */
import { Combobox as ArkCombobox, createListCollection } from '@ark-ui/react/combobox'
import { Portal } from '@ark-ui/react/portal'
import { type ReactNode, useMemo, useState } from 'react'
import { css, cx } from 'styled-system/css'
import { CheckIcon, PlusIcon } from './icons'
import { fade, optionItem, optionList } from './overlay'
import { input, overlaySurface } from './recipes'

export interface ComboboxOption {
  value: string
  label: string
  /** 名前の前に出す小さなアイコン（使用技術のアイコン）。飾りなので読み上げない */
  icon?: ReactNode
}

export interface ComboboxProps {
  label: string
  options: ComboboxOption[]
  onSelect: (value: string) => void
  /** 選び済みの候補（✓ を付ける）。この欄自体は何も選んでいない状態のままで、選び直しは onSelect に渡す */
  selectedValues?: string[]
  /** 選んでも一覧を閉じない */
  keepOpen?: boolean
  /** 入力した名前で新しく作る。渡さなければ「新しく作る」候補を出さない */
  onCreate?: (text: string) => void
  /** 「新しく作る」を出さない名前。候補に出していないもの（選び済みなど）も含めて渡す。省くと候補の名前 */
  knownLabels?: string[]
  createLabel?: (text: string) => string
  placeholder?: string
  emptyText: string
  disabled?: boolean
  invalid?: boolean
  /** 出したらすぐ入力欄にフォーカスし、候補の一覧を開く（「+ 追加」を押して出す使い方） */
  autoFocus?: boolean
  /**
   * 候補の一覧が閉じたとき。`moveFocus` は、外を押したりフォーカスを外へ移したりして閉じたとき false
   * （利用者が移った先からフォーカスを奪わない）。選んだ・Esc で閉じたときは true
   */
  onClose?: (details: { moveFocus: boolean }) => void
}

const checkMark = css({
  display: 'inline-flex',
  visibility: 'hidden',
  '&[data-selected=true]': { visibility: 'visible' },
})

/** 「新しく作る」候補の値。候補の値（ID）と重ならない形にする */
const CREATE_VALUE = '\u0000create'

function includesText(itemText: string, filterText: string): boolean {
  return itemText.toLocaleLowerCase().includes(filterText.toLocaleLowerCase())
}

export function Combobox({
  label,
  options,
  onSelect,
  selectedValues = [],
  keepOpen = false,
  onCreate,
  knownLabels,
  createLabel = (text) => `「${text}」を追加`,
  placeholder,
  emptyText,
  disabled,
  invalid,
  autoFocus = false,
  onClose,
}: ComboboxProps) {
  const [inputValue, setInputValue] = useState('')
  const text = inputValue.trim()
  const canCreate =
    onCreate !== undefined &&
    text !== '' &&
    !(knownLabels ?? options.map((option) => option.label)).some(
      (known) => known.toLocaleLowerCase() === text.toLocaleLowerCase(),
    )

  const createText = canCreate ? createLabel(text) : null

  const collection = useMemo(() => {
    const matched = options.filter((option) => includesText(option.label, inputValue))
    const items = createText === null ? matched : [...matched, { value: CREATE_VALUE, label: createText }]
    return createListCollection({ items })
  }, [options, inputValue, createText])

  return (
    <ArkCombobox.Root
      collection={collection}
      // 選んだものは欄の外に並べるので、この欄自体は何も選んでいない状態のまま
      value={[]}
      inputValue={inputValue}
      onInputValueChange={(details) => setInputValue(details.inputValue)}
      onValueChange={(details) => {
        const selected = details.value[0]
        if (selected === undefined) return
        if (selected === CREATE_VALUE) onCreate?.(text)
        else onSelect(selected)
        setInputValue('')
      }}
      selectionBehavior="clear"
      closeOnSelect={!keepOpen}
      inputBehavior="autohighlight"
      disabled={disabled}
      invalid={invalid}
      openOnClick
      autoFocus={autoFocus}
      defaultOpen={autoFocus}
      onOpenChange={(details) => {
        if (!details.open) onClose?.({ moveFocus: details.reason !== 'interact-outside' })
      }}
      // 候補が多いと一覧が画面の外まで伸びるので、画面に収まる高さに抑えてスクロールさせる
      positioning={{ sameWidth: true, fitViewport: true }}
      lazyMount
      unmountOnExit
      className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}
    >
      <ArkCombobox.Label className={css({ textStyle: 'label', color: 'text.muted' })}>{label}</ArkCombobox.Label>
      <ArkCombobox.Control>
        <ArkCombobox.Input placeholder={placeholder} className={input()} />
      </ArkCombobox.Control>
      <Portal>
        <ArkCombobox.Positioner>
          <ArkCombobox.Content
            className={cx(overlaySurface(), optionList, fade, css({ maxH: 'inherit', overflowY: 'auto' }))}
          >
            <ArkCombobox.Empty className={css({ px: 'inset-dense', textStyle: 'body-sm', color: 'text.muted' })}>
              {emptyText}
            </ArkCombobox.Empty>
            {collection.items.map((option) => {
              const selected = selectedValues.includes(option.value)
              return (
                <ArkCombobox.Item key={option.value} item={option} className={optionItem}>
                  {option.value === CREATE_VALUE ? (
                    <PlusIcon size="sm" />
                  ) : (
                    <span data-selected={selected} className={checkMark}>
                      <CheckIcon size="sm" />
                    </span>
                  )}
                  {option.icon}
                  {/* 候補の共通の見た目（optionItem）は space-between なので、名前を残りの幅に広げて左に寄せる */}
                  <ArkCombobox.ItemText className={css({ flex: '1' })}>{option.label}</ArkCombobox.ItemText>
                  {/* aria-selected は Ark UI がハイライト中の候補に使うので、選び済みは文字で読み上げる */}
                  {selected && <span className={css({ srOnly: true })}>（選択済み）</span>}
                </ArkCombobox.Item>
              )
            })}
          </ArkCombobox.Content>
        </ArkCombobox.Positioner>
      </Portal>
    </ArkCombobox.Root>
  )
}

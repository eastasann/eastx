/**
 * スイッチ（Ark UI の Switch に見た目を付けたもの）。使用技術の「トップに表示する」（A7）などのオン・オフに使う。
 * 中身は隠した checkbox なので、フォームの送信とキーボードの操作はそのまま効く
 */
import { Switch as ArkSwitch } from '@ark-ui/react/switch'
import { css } from 'styled-system/css'

export interface SwitchProps {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  name?: string
  disabled?: boolean
}

const control = css({
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
  w: 'control',
  h: 'icon',
  p: 'none',
  bg: 'bg.muted',
  borderWidth: 'default',
  borderStyle: 'solid',
  borderColor: 'border.strong',
  borderRadius: 'chip',
  cursor: 'pointer',
  transitionProperty: 'background-color, border-color',
  transitionDuration: 'motion.hover',
  transitionTimingFunction: 'motion.hover',
  _checked: { bg: 'action.default', borderColor: 'action.default', justifyContent: 'flex-end' },
  _disabled: { opacity: 'disabled', cursor: 'not-allowed' },
  // 隠した checkbox がフォーカスを持つので、見た目の輪はこちらに出す
  _focusVisible: { outlineWidth: 'focus-ring', outlineStyle: 'solid', outlineColor: 'focus-ring' },
})

const thumb = css({
  w: 'icon-sm',
  h: 'icon-sm',
  bg: 'surface.default',
  borderRadius: 'chip',
})

export function Switch({ label, checked, onCheckedChange, name, disabled }: SwitchProps) {
  return (
    <ArkSwitch.Root
      checked={checked}
      onCheckedChange={(details) => onCheckedChange(details.checked)}
      name={name}
      disabled={disabled}
      className={css({ display: 'inline-flex', alignItems: 'center', gap: 'inline', cursor: 'pointer' })}
    >
      <ArkSwitch.Control className={control}>
        <ArkSwitch.Thumb className={thumb} />
      </ArkSwitch.Control>
      <ArkSwitch.Label className={css({ textStyle: 'ui' })}>{label}</ArkSwitch.Label>
      <ArkSwitch.HiddenInput />
    </ArkSwitch.Root>
  )
}

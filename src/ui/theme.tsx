/**
 * テーマ（ライト・ダーク）の設定と切り替え（design-spec 4.4・6.1.2、ADR-014）。
 * 描画の前の <html data-theme> は <head> のスクリプト（THEME_INIT_SCRIPT）が入れ、ここは切り替えたあとと、
 * OS に合わせる設定で OS の設定が変わったときに入れ直す
 */
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { css, cx } from 'styled-system/css'
import { MonitorIcon, MoonIcon, SunIcon } from './icons'
import { nextThemePreference, THEME_COOKIE, type ThemePreference, writePreferenceCookie } from './preferences'
import { button } from './recipes'

interface ThemeContextValue {
  preference: ThemePreference
  setPreference: (preference: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const DARK_QUERY = '(prefers-color-scheme: dark)'

function applyTheme(preference: ThemePreference): void {
  const dark = preference === 'dark' || (preference === 'system' && window.matchMedia(DARK_QUERY).matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

/** `initial` は SSR で読んだ Cookie の設定。サーバーとブラウザの最初の描画を揃えるため、ここから始める */
export function ThemeProvider({ initial, children }: { initial: ThemePreference; children: ReactNode }) {
  const [preference, setPreferenceState] = useState(initial)

  useEffect(() => {
    applyTheme(preference)
    if (preference !== 'system') return
    const media = window.matchMedia(DARK_QUERY)
    const onChange = () => applyTheme('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [preference])

  const setPreference = useCallback((next: ThemePreference) => {
    writePreferenceCookie(THEME_COOKIE, next)
    setPreferenceState(next)
  }, [])

  const value = useMemo(() => ({ preference, setPreference }), [preference, setPreference])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('ThemeToggle は ThemeProvider の中で使う')
  return value
}

export interface ThemeLabels {
  /** ボタンの読み上げ名。今の設定と、押したあとの設定の名前を受ける */
  toggle: (current: string, next: string) => string
  system: string
  light: string
  dark: string
}

const ICONS = { system: MonitorIcon, light: SunIcon, dark: MoonIcon } as const

/** ツールチップ（asChild）が付ける属性とイベントを受け取れるよう、button の属性を通す */
export interface ThemeToggleProps extends Omit<ComponentProps<'button'>, 'children' | 'onClick' | 'type'> {
  labels: ThemeLabels
  /** アイコンの横に今の設定の名前を出す（管理画面のサイドメニュー） */
  showLabel?: boolean
  className?: string
  /** 切り替えたとき。切り替えた先の設定を受ける（公開側の解析の theme_switch） */
  onSwitch?: (to: ThemePreference) => void
}

/** 押すたびに「OSに合わせる → ライト → ダーク」と切り替え、選んだ設定を Cookie に覚える */
export function ThemeToggle({ labels, showLabel = false, className, onSwitch, ...rest }: ThemeToggleProps) {
  const { preference, setPreference } = useTheme()
  const next = nextThemePreference(preference)
  const Icon = ICONS[preference]
  return (
    <button
      {...rest}
      type="button"
      onClick={() => {
        setPreference(next)
        onSwitch?.(next)
      }}
      aria-label={labels.toggle(labels[preference], labels[next])}
      // 文字付きは button の寄せ・余白を上書きするので、cx でクラスを並べず1つの css にまとめる
      className={cx(
        css(
          button.raw({ variant: 'ghost', shape: showLabel ? 'default' : 'icon' }),
          showLabel ? { justifyContent: 'flex-start', px: 'inset-dense' } : {},
        ),
        className,
      )}
    >
      <Icon />
      {showLabel && <span aria-hidden="true">{labels[preference]}</span>}
    </button>
  )
}

import { useSyncExternalStore } from 'react'
import { BREAKPOINTS } from '~/styles/breakpoints'

/**
 * メディアクエリに合うか。CSS だけでは切り替えられないもの（2つ描くと状態が分かれる部品・ツールチップの有無）に使う。
 * サーバーでは false（使うのは ssr: false の管理画面だけ）
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query)
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

// Panda が出すメディアクエリと同じ形（範囲の構文・rem）にし、CSS と JavaScript の切り替わる幅を揃える
const rem = (px: number) => `${px / 16}rem`
export const MEDIA = {
  mobile: `(width < ${rem(BREAKPOINTS.tablet)})`,
  tablet: `(${rem(BREAKPOINTS.tablet)} <= width < ${rem(BREAKPOINTS.desktop)})`,
  /** 管理画面の L5 で、設定パネルを右に常に出す幅 */
  wide: `(width >= ${rem(BREAKPOINTS.wide)})`,
} as const

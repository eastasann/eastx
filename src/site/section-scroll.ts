/**
 * トップのセクションのスクロールの位置（design-spec 1.4 の言語の切り替え、SDD 4.1）
 */
import { useLocation } from '@tanstack/react-router'
import { useEffect } from 'react'
import { MENU_SECTIONS } from '~/content/site-chrome'
import type { TopSectionId } from './history-state'

const TOP_SECTIONS: readonly TopSectionId[] = ['profile', ...MENU_SECTIONS]

/**
 * いま画面の上端（固定ヘッダーの下）にかかっているセクション。どのセクションも上端より下なら undefined
 */
export function visibleSection(): TopSectionId | undefined {
  const offset = Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0
  let current: TopSectionId | undefined
  for (const id of TOP_SECTIONS) {
    const element = document.getElementById(id)
    if (element && element.getBoundingClientRect().top <= offset + 1) current = id
  }
  return current
}

/** セクションへのスクロールを済ませた履歴の key。トップを離れて戻ったときも覚えているよう、部品の外に持つ */
const scrolledEntries = new Set<string>()

/**
 * history state の `section` があれば、そのセクションまでスクロールする。トップ（L1）が使う。
 * ルーターがページの先頭へ戻したあとに動くよう、描画のあとの次のフレームで動かす。
 * 1つの履歴で1回だけ動かす。「戻る」「進む」で同じ履歴に来たときは、ルーターが戻したスクロールの位置を優先する。
 * history state から section を消す方法は採らない（履歴の置き換えでルーターが読み込み直し、ページの先頭へ戻すため）
 */
export function useScrollToStateSection(): void {
  const location = useLocation()
  const section = location.state.section
  const key = location.state.__TSR_key
  useEffect(() => {
    if (section === undefined || key === undefined || scrolledEntries.has(key)) return
    const frame = requestAnimationFrame(() => {
      scrolledEntries.add(key)
      document.getElementById(section)?.scrollIntoView()
    })
    return () => cancelAnimationFrame(frame)
  }, [section, key])
}

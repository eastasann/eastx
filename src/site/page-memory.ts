/**
 * トップのセクション内ページングの、履歴ごとのページ番号（design-spec 6.1.3 の「戻ってきたとき」、SDD 4.1）。
 * history state ではなく sessionStorage に、履歴のキー（`__TSR_key`）ごとに持つ。TanStack Router の history は
 * `window.history.replaceState` を包んでいて、書くとルーターが読み込み直し、URL にハッシュがあればそこへスクロールし直すため
 */
import type { PagedSectionId } from './history-state'

const PREFIX = 'eastx:pages:'

export type SavedPages = Partial<Record<PagedSectionId, number>>

// sessionStorage を使えない環境（止めたブラウザ・容量の上限）では覚えない。「戻る」で1ページ目になるだけで、表示は続けられる
function storage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function readSavedPages(entryKey: string): SavedPages {
  const raw = storage()?.getItem(`${PREFIX}${entryKey}`)
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    // 数でない値（手で書き換えられたものなど）は覚えていないものとして扱う
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => Number.isFinite(entry[1])),
    ) as SavedPages
  } catch {
    return {}
  }
}

export function savePage(entryKey: string, id: PagedSectionId, page: number): void {
  const pages = { ...readSavedPages(entryKey), [id]: page }
  try {
    storage()?.setItem(`${PREFIX}${entryKey}`, JSON.stringify(pages))
  } catch {
    // 容量の上限で書けないときも、上と同じく覚えないだけにする
  }
}

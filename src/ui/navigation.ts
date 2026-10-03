import type { MouseEvent } from 'react'

/** 修飾キー付きのクリック（新しいタブで開くなど）はブラウザに任せ、ルーターでの移動に置き換えない */
export function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

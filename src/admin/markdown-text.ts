/**
 * L5 の Markdown エディタの本文の扱い（src/admin/markdown-editor.tsx）。画像のアップロード中の仮の記法と、
 * エディタの外で変わった値を入れるときの置き換えの範囲
 */
export const UPLOADING_TEXT = 'アップロード中…'

/** アップロード中の仮の記法。終わったら本文の中から探して置き換えるので、1つずつ違う値にする */
export function uploadMarker(): string {
  return `![${UPLOADING_TEXT}](uploading-${crypto.randomUUID()})`
}

const UPLOAD_MARKER = /!\[アップロード中…\]\(uploading-[0-9a-f-]+\)/g

/** アップロード中の仮の記法を除いた本文。プレビューで、存在しない画像を読みに行かせない */
export function withoutUploadMarkers(markdown: string): string {
  return markdown.replace(UPLOAD_MARKER, '')
}

/** `before` を `after` にするための、前後の同じ部分を除いた1か所の置き換え */
export function differingRange(before: string, after: string): { from: number; to: number; insert: string } {
  let start = 0
  const shorter = Math.min(before.length, after.length)
  while (start < shorter && before[start] === after[start]) start++
  let end = 0
  while (end < shorter - start && before[before.length - 1 - end] === after[after.length - 1 - end]) {
    end++
  }
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) }
}

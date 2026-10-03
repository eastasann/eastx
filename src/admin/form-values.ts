/**
 * 編集ビューのフォームの値の扱い（ADR-008）。値は JSON にできる形（文字列・真偽値・配列・オブジェクト）だけを持つ
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * 保存に成功したあとにフォームへ入れる値。保存を送ってから応答が返るまでに書き換えた欄は今の値のまま残し、
 * 書き換えていない欄だけを保存した値（サーバーで空白を除いたものなど）にする。応答を待つあいだの入力を消さないため。
 * オブジェクトは欄ごとに比べ、配列（使用技術・SNS リンク）は1つの欄として比べる
 */
export function rebaseValues<V>(sent: V, current: V, saved: V): V {
  if (isPlainObject(sent) && isPlainObject(current) && isPlainObject(saved)) {
    const merged: Record<string, unknown> = { ...saved }
    for (const key of Object.keys(saved)) merged[key] = rebaseValues(sent[key], current[key], saved[key])
    return merged as V
  }
  return sameJson(sent, current) ? saved : current
}

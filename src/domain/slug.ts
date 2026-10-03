/**
 * スラッグと使用技術の識別名の規則（design-spec 6.7.1・6.7.2）。
 * 形式は半角の英小文字・数字・ハイフンだけで、DB の CHECK 制約（SDD 6.4）と同じ。
 */

/** スラッグ・識別名の文字数の上限（SDD 5.0） */
export const SLUG_MAX_LENGTH = 100

/** スラッグ・識別名の形式（空でない、英小文字・数字・ハイフンだけ） */
export const SLUG_PATTERN = /^[a-z0-9-]+$/

/**
 * 英語のタイトル（使用技術では表示名）からスラッグの元になる値を作る。変換して空になるときは null。
 * アクセント付きの文字は基の文字に戻し、英数字以外の並びはハイフン1つにまとめ、両端のハイフンを落とす。
 */
export function slugify(title: string): string | null {
  const slug = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '')
  return slug === '' ? null : slug
}

/**
 * `base` が使われていればその末尾に `-2`、`-3` … を付け、`isTaken` に当たらない最初の値を返す。
 * 連番を付けても上限の文字数に収まるよう、必要なら `base` の末尾を削る。
 */
export function firstAvailable(base: string, isTaken: (candidate: string) => boolean): string {
  if (!isTaken(base)) return base
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const head = base.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(/-+$/, '')
    const candidate = `${head}${suffix}`
    if (!isTaken(candidate)) return candidate
  }
}

/** 識別名を表示名から作るとき、変換して空になる場合の値（design-spec 6.7.1） */
const STACK_KEY_FALLBACK = 'stack'

export function stackKeyBase(displayName: string): string {
  return slugify(displayName) ?? STACK_KEY_FALLBACK
}

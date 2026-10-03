/**
 * ルート `/` の言語の振り分け（design-spec 1.4、SDD 9章）。
 * 以前に選んだ言語（Cookie eastx-lang）があればそれ、なければ Accept-Language の
 * 最優先の言語タグが `ja` で始まるとき日本語、それ以外は英語。
 */

export const LANGS = ['ja', 'en'] as const
export type Lang = (typeof LANGS)[number]

export function isLang(value: string | undefined | null): value is Lang {
  return value === 'ja' || value === 'en'
}

/** Cookie ヘッダーから名前の値を取り出す */
export function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return undefined
}

/** Accept-Language を q 値の降順に並べたときの最優先の言語タグ */
export function primaryLanguageTag(acceptLanguage: string | null): string | undefined {
  if (!acceptLanguage) return undefined
  const tags = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1
      return { tag: (tag ?? '').trim(), q: Number.isNaN(q) ? 0 : q }
    })
    .filter((t) => t.tag !== '' && t.q > 0)
    .sort((a, b) => b.q - a.q)
  return tags[0]?.tag
}

export function detectLang(cookieHeader: string | null, acceptLanguage: string | null): Lang {
  const saved = readCookie(cookieHeader, 'eastx-lang')
  if (isLang(saved)) return saved
  const primary = primaryLanguageTag(acceptLanguage)
  return primary?.toLowerCase().startsWith('ja') ? 'ja' : 'en'
}

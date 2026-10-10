/**
 * Analytics Engine の SQL API の1日ぶんの応答の行（src/api/analytics/queries.ts の問い合わせの形）。記録の値と訪問者の
 * ハッシュの組ごとの件数で、数は本物と同じく文字列で返す。blob の位置は SDD 5.14 の表（src/domain/analytics/data-point.ts）
 */
export type SqlApiRow = Record<string, string>

interface EventFields {
  type: string
  visitor: string
  /** その組の `SUM(_sample_interval)` */
  n?: number
  path?: string
  lang?: string
  referrer?: string
  utm?: string
  country?: string
  device?: string
  browserLang?: string
  section?: string
  itemId?: string
  linkKind?: string
  host?: string
  to?: string
}

/** 1組。パス・言語・国・デバイス・ブラウザの言語は指定が無ければ P1（/ja）を日本のデスクトップで見た値 */
export function eventRow(fields: EventFields): SqlApiRow {
  const blobs = [
    fields.type,
    fields.path ?? '/ja',
    fields.lang ?? 'ja',
    fields.referrer ?? '',
    fields.utm ?? '',
    fields.country ?? 'JP',
    fields.device ?? 'desktop',
    fields.browserLang ?? 'ja',
    fields.section ?? '',
    fields.itemId ?? '',
    fields.linkKind ?? '',
    fields.host ?? '',
    fields.to ?? '',
    fields.visitor,
  ]
  return { ...Object.fromEntries(blobs.map((value, i) => [`blob${i + 1}`, value])), n: String(fields.n ?? 1) }
}

/** P1（/ja）の閲覧を `count` 件、`visitors` 人で（最初の人が残りの件数を持つ） */
export function pageViewRows(count: number, visitors: number): SqlApiRow[] {
  return Array.from({ length: visitors }, (_, i) =>
    eventRow({ type: 'page_view', visitor: `v${i}`, n: i === 0 ? count - visitors + 1 : 1 }),
  )
}

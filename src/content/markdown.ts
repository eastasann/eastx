/**
 * 公開側の Markdown の本文を、項目単位の代替表示で言語を選んでから描画する（design-spec 1.4、ADR-011）
 */
import type { Lang } from '~/i18n/detect'
import { type MarkdownKind, renderMarkdownCached } from '~/markdown/cache'
import { type Bilingual, type LocalizedHtml, pickText } from './localize'

export interface MarkdownOwner {
  kind: MarkdownKind
  id: string
  updatedAt: Date
}

/** 出す言語の本文が空ならもう片方の言語の本文を描画する。どちらも空なら null */
export async function renderLocalizedMarkdown(
  owner: MarkdownOwner,
  primary: Lang,
  bodies: Bilingual<string | null>,
  siteUrl: string,
): Promise<LocalizedHtml | null> {
  const picked = pickText(primary, bodies)
  if (picked === null) return null
  const html = await renderMarkdownCached(
    { kind: owner.kind, id: owner.id, lang: picked.lang, updatedAt: owner.updatedAt.getTime(), markdown: picked.value },
    { siteOrigin: new URL(siteUrl).origin },
  )
  return { html, lang: picked.lang }
}

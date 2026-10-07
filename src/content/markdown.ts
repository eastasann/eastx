/**
 * 公開側の Markdown の本文を、項目単位の代替表示で言語を選んでから描画する（design-spec 1.4、ADR-011）
 */
import type { Lang } from '~/i18n/detect'
import { type MarkdownKind, renderMarkdownCached } from '~/markdown/cache'
import type { MarkdownStack } from '~/markdown/render'
import { type Bilingual, type LocalizedHtml, pickText } from './localize'

export interface MarkdownOwner {
  kind: MarkdownKind
  id: string
  updatedAt: Date
}

/**
 * 出す言語の本文が空ならもう片方の言語の本文を描画する。どちらも空なら null。
 * stacks は自己紹介の描画だけが渡す（太字と使用技術の照合。ADR-012）
 */
export async function renderLocalizedMarkdown(
  owner: MarkdownOwner,
  primary: Lang,
  bodies: Bilingual<string | null>,
  siteUrl: string,
  stacks?: MarkdownStack[],
): Promise<LocalizedHtml | null> {
  const picked = pickText(primary, bodies)
  if (picked === null) return null
  const html = await renderMarkdownCached(
    { kind: owner.kind, id: owner.id, lang: picked.lang, updatedAt: owner.updatedAt.getTime(), markdown: picked.value },
    { siteOrigin: new URL(siteUrl).origin, stacks },
  )
  return { html, lang: picked.lang }
}

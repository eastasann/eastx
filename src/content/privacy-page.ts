/**
 * P6 プライバシーの中身（SDD 5.11 の getPrivacyPage、design-spec 6.2.4）。
 * 行が無い・本文が日英とも空なら notFound()（C1）。公開の状態を持たないので、本文の有無だけで出すかを決める
 */
import { notFound } from '@tanstack/react-router'
import { privacyPage } from '~/db/schema'
import { excerptOf } from '~/domain/excerpt'
import { hasPrivacyPage } from '~/domain/languages'
import type { Lang } from '~/i18n/detect'
import { getMessages } from '~/i18n/messages'
import { pickText } from './localize'
import { renderLocalizedMarkdown } from './markdown'
import { pageMeta, titleWithSiteName } from './meta'
import { type ContentContext, required } from './shared'
import type { PrivacyPageView } from './types'

export async function loadPrivacyPage({ db, siteUrl }: ContentContext, lang: Lang): Promise<PrivacyPageView> {
  const row = await db
    .select({
      id: privacyPage.id,
      bodyJa: privacyPage.bodyJa,
      bodyEn: privacyPage.bodyEn,
      updatedAt: privacyPage.updatedAt,
    })
    .from(privacyPage)
    .limit(1)
    .get()
  if (!row || !hasPrivacyPage({ ja: { body: row.bodyJa }, en: { body: row.bodyEn } })) throw notFound()
  const bodies = { ja: row.bodyJa, en: row.bodyEn }
  // 本文はどちらかの言語にある（上の判定）ので、描画した結果も抜粋の元も空にならない
  const body = required(
    await renderLocalizedMarkdown({ kind: 'privacy', id: row.id, updatedAt: row.updatedAt }, lang, bodies, siteUrl),
    'privacy_page.body',
  )
  const bodyText = required(pickText(lang, bodies), 'privacy_page.body')
  const messages = getMessages(lang)
  return {
    lang,
    meta: pageMeta({
      siteUrl,
      lang,
      path: '/privacy',
      title: titleWithSiteName(messages.privacy.title, messages.siteName),
      description: excerptOf(bodyText.value, bodyText.lang),
      imagePath: null,
    }),
    body,
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * 公開側のページの <head>（ADR-019）。タイトル・説明・OGP・canonical・hreflang
 */
import { defaultOgImagePath, titleWithSiteName } from '~/content/meta'
import type { PageMeta } from '~/content/types'
import type { Lang } from '~/i18n/detect'
import { getMessages } from '~/i18n/messages'
import { siteOrigin } from './site-origin'

const OG_LOCALES: Record<Lang, string> = { ja: 'ja_JP', en: 'en_US' }

type Tag = Record<string, string>

interface Head {
  meta: Tag[]
  links?: Tag[]
}

function localeMeta(lang: Lang): Tag[] {
  return [
    { property: 'og:locale', content: OG_LOCALES[lang] },
    { property: 'og:locale:alternate', content: OG_LOCALES[lang === 'ja' ? 'en' : 'ja'] },
  ]
}

/** P1〜P6 */
export function pageHead(lang: Lang, meta: PageMeta): Head {
  const url = meta.alternates[lang]
  const description: Tag[] = meta.description
    ? [
        { name: 'description', content: meta.description },
        { property: 'og:description', content: meta.description },
      ]
    : []
  return {
    meta: [
      { title: meta.title },
      ...description,
      { property: 'og:title', content: meta.title },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: getMessages(lang).siteName },
      { property: 'og:url', content: url },
      { property: 'og:image', content: meta.ogImageUrl },
      ...localeMeta(lang),
    ],
    links: [
      { rel: 'canonical', href: url },
      { rel: 'alternate', hrefLang: 'ja', href: meta.alternates.ja },
      { rel: 'alternate', hrefLang: 'en', href: meta.alternates.en },
      // x-default はルート `/`（言語を振り分ける入口）
      { rel: 'alternate', hrefLang: 'x-default', href: new URL('/', url).toString() },
    ],
  }
}

/**
 * C1・C2。タイトルは見出しの文言、OGP 画像は既定の画像（ADR-019）。
 * 存在しない・表示できない URL なので、canonical と hreflang は出さない
 */
export function statusHead(lang: Lang, kind: 'notFound' | 'error'): Head {
  const messages = getMessages(lang)
  const title = titleWithSiteName(messages[kind].title, messages.siteName)
  return {
    meta: [
      { title },
      { property: 'og:title', content: title },
      { property: 'og:image', content: new URL(defaultOgImagePath(lang), siteOrigin()).toString() },
      ...localeMeta(lang),
    ],
  }
}

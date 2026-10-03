/**
 * ページのタイトル・説明・OGP 画像・言語ごとの URL（ADR-019）。絶対 URL は SITE_URL から作る
 */
import { LANGS, type Lang } from '~/i18n/detect'
import type { PageMeta } from './types'

export interface PageMetaInput {
  siteUrl: string
  lang: Lang
  /** 言語の後ろのパス。トップは ''、作品詳細は '/works/{slug}' */
  path: string
  title: string
  description: string | null
  /** サムネイル（`/media/...`）。なければ言語ごとの既定の画像 */
  imagePath: string | null
}

export function absoluteUrl(siteUrl: string, path: string): string {
  return new URL(path, siteUrl).toString()
}

export function defaultOgImagePath(lang: Lang): string {
  return `/og/default-${lang}.png`
}

export function pageMeta({ siteUrl, lang, path, title, description, imagePath }: PageMetaInput): PageMeta {
  const alternates = Object.fromEntries(LANGS.map((l) => [l, absoluteUrl(siteUrl, `/${l}${path}`)])) as Record<
    Lang,
    string
  >
  return {
    title,
    description,
    ogImageUrl: absoluteUrl(siteUrl, imagePath ?? defaultOgImagePath(lang)),
    alternates,
  }
}

/** `{タイトル} — {サイト名}`（ADR-019 の P2〜P5・C1・C2） */
export function titleWithSiteName(title: string, siteName: string): string {
  return `${title} — ${siteName}`
}

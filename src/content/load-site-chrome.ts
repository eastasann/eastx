/**
 * フッターの中身を D1 から読む（SDD 5.11）。形は site-chrome.ts。解析の送信のオン・オフは D1 を読まず、
 * Worker の変数 ANALYTICS_BEACON（呼び出し側が渡す）で決める
 */
import { asc } from 'drizzle-orm'
import type { Db } from '~/db/client'
import { privacyPage, profile, socialLink } from '~/db/schema'
import { hasPrivacyPage } from '~/domain/languages'
import { bodyPresence } from './shared'
import type { SiteChromeView } from './site-chrome'

export async function loadSiteChrome(db: Db, analyticsBeacon: string | undefined): Promise<SiteChromeView> {
  const [profiles, links, privacy] = await db.batch([
    db.select({ id: profile.id }).from(profile).limit(1),
    db
      .select({ service: socialLink.service, url: socialLink.url, label: socialLink.label })
      .from(socialLink)
      .orderBy(asc(socialLink.sortOrder)),
    db
      .select({ bodyJa: bodyPresence(privacyPage.bodyJa), bodyEn: bodyPresence(privacyPage.bodyEn) })
      .from(privacyPage)
      .limit(1),
  ])
  const page = privacy[0]
  return {
    socialLinks: profiles.length > 0 ? links : [],
    hasPrivacyPage: hasPrivacyPage(page ? { ja: { body: page.bodyJa }, en: { body: page.bodyEn } } : null),
    analyticsBeacon: analyticsBeacon === 'on',
  }
}

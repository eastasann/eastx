/**
 * フッターの中身を D1 から読む（SDD 5.11）。形は site-chrome.ts
 */
import { asc } from 'drizzle-orm'
import type { Db } from '~/db/client'
import { profile, socialLink } from '~/db/schema'
import type { SiteChromeView } from './site-chrome'

export async function loadSiteChrome(db: Db): Promise<SiteChromeView> {
  const [profiles, links] = await db.batch([
    db.select({ id: profile.id }).from(profile).limit(1),
    db
      .select({ service: socialLink.service, url: socialLink.url, label: socialLink.label })
      .from(socialLink)
      .orderBy(asc(socialLink.sortOrder)),
  ])
  return { socialLinks: profiles.length > 0 ? links : [] }
}

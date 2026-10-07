/**
 * 公開側の全画面（C1・C2 を含む）のフッターの中身の形（SDD 5.11 の SiteChromeView、design-spec 6.1.2）。ヘッダーは D1 の中身を使わない。
 * ブラウザでも読むので、D1 からの読み取り（load-site-chrome.ts）と分けて Drizzle を import しない
 */
import type { SOCIAL_SERVICES } from '~/db/enums'

export type SocialService = (typeof SOCIAL_SERVICES)[number]

export interface SiteChromeView {
  /** プロフィールの SNS リンク。並びは管理画面で決めた順。プロフィールがなければ空 */
  socialLinks: { service: SocialService; url: string; label: string | null }[]
}

/** 中身を読めなかったとき（C2・どのルートにも当たらない C1）のフッター。SNS は出さない */
export const EMPTY_SITE_CHROME: SiteChromeView = { socialLinks: [] }

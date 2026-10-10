/**
 * 公開側の全画面（C1・C2 を含む）の共通の中身の形（SDD 5.11 の SiteChromeView）。フッター（design-spec 6.1.2）と、
 * 解析の送信のオン・オフ（ADR-023）。ヘッダーは D1 の中身を使わない。
 * ブラウザでも読むので、D1 からの読み取り（load-site-chrome.ts）と分けて Drizzle を import しない
 */
import type { SOCIAL_SERVICES } from '~/db/enums'

export type SocialService = (typeof SOCIAL_SERVICES)[number]

export interface SiteChromeView {
  /** プロフィールの SNS リンク。並びは管理画面で決めた順。プロフィールがなければ空 */
  socialLinks: { service: SocialService; url: string; label: string | null }[]
  /** プライバシーのページの本文が日英のどちらかにある（false ならフッターにリンクを出さない） */
  hasPrivacyPage: boolean
  /** ブラウザの解析の送信を動かす（Worker の変数 ANALYTICS_BEACON が on。src/site/analytics.ts） */
  analyticsBeacon: boolean
}

/**
 * 中身を読めなかったとき（読み取りに失敗した C1・C2、どのルートにも当たらない C1）。
 * SNS もプライバシーのページへのリンクも出さず、解析も送らない
 */
export const EMPTY_SITE_CHROME: SiteChromeView = { socialLinks: [], hasPrivacyPage: false, analyticsBeacon: false }

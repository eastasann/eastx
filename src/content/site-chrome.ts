/**
 * 公開側の全画面（C1・C2 を含む）のヘッダーとフッターの中身の形（SDD 5.11 の SiteChromeView、design-spec 6.1.2）。
 * ブラウザでも読むので、D1 からの読み取り（load-site-chrome.ts）と分けて Drizzle を import しない
 */
import type { SOCIAL_SERVICES } from '~/db/enums'

/** トップのセクションのうち、ヘッダーのメニューに出るもの。並びは P1 と同じ（SDD 4.1） */
export const MENU_SECTIONS = ['career', 'projects', 'works', 'stack', 'blog', 'coding'] as const
export type SectionId = (typeof MENU_SECTIONS)[number]

export type SocialService = (typeof SOCIAL_SERVICES)[number]

export interface SiteChromeView {
  /** P1 に出るセクション（中身が1件以上。design-spec 6.1.5） */
  sections: SectionId[]
  /** プロフィールの SNS リンク。並びは管理画面で決めた順。プロフィールがなければ空 */
  socialLinks: { service: SocialService; url: string; label: string | null }[]
}

/** 中身を読めなかったとき（C2・どのルートにも当たらない C1）のヘッダーとフッター。セクションと SNS は出さない */
export const EMPTY_SITE_CHROME: SiteChromeView = { sections: [], socialLinks: [] }

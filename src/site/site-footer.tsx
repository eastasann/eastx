/**
 * 公開側のフッター（design-spec 6.1.2）。コピーライト、プライバシーのページへのリンク（本文があるとき）と、
 * プロフィールと同じ SNS リンクをサービス名の文字で出す
 */
import { Link } from '@tanstack/react-router'
import { css } from 'styled-system/css'
import type { SiteChromeView, SocialService } from '~/content/site-chrome'
import type { Lang } from '~/i18n/detect'
import type { Messages } from '~/i18n/messages'

/** サービス名は日英で同じ固有名なので、辞書に置かない。other は管理画面で入れた表示名を使う */
const SERVICE_NAMES: Record<Exclude<SocialService, 'other'>, string> = {
  github: 'GitHub',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  x: 'X',
  zenn: 'Zenn',
  qiita: 'Qiita',
}

export function socialLinkName(link: SiteChromeView['socialLinks'][number]): string {
  return link.service === 'other' ? (link.label ?? link.url) : SERVICE_NAMES[link.service]
}

export interface SiteFooterProps {
  lang: Lang
  chrome: SiteChromeView
  messages: Messages
}

// プライバシーのページへのリンクも SNS のリンクと同じ見た目にする（design-spec 6.1.2）
const footerLink = css({
  textStyle: 'ui',
  color: 'text.muted',
  textDecoration: 'none',
  _hover: { color: 'link.default', textDecoration: 'underline' },
})

export function SiteFooter({ lang, chrome, messages }: SiteFooterProps) {
  const { socialLinks, hasPrivacyPage } = chrome
  return (
    <footer
      className={css({
        py: 'stack',
        borderTopWidth: 'default',
        borderTopStyle: 'solid',
        borderTopColor: 'border.default',
      })}
    >
      <div
        className={css({
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'inline',
          maxW: 'site-column',
          mx: 'auto',
          px: 'gutter',
        })}
      >
        {/* コピーライトとプライバシーのリンクを1つにまとめ、モバイルで折り返しても「©・プライバシー・SNS」の順を保つ */}
        <div className={css({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'inline' })}>
          <p className={css({ textStyle: 'meta', color: 'text.muted' })}>{messages.footer.copyright}</p>
          {hasPrivacyPage && (
            <Link to="/$lang/privacy" params={{ lang }} className={footerLink}>
              {messages.privacy.title}
            </Link>
          )}
        </div>
        {socialLinks.length > 0 && (
          <ul aria-label={messages.footer.social} className={css({ display: 'flex', flexWrap: 'wrap', gap: 'inline' })}>
            {socialLinks.map((link, index) => (
              // 同じ URL を2回登録できるので、並びの位置で区別する（並べ替えは画面を読み込み直すまで起きない）
              // biome-ignore lint/suspicious/noArrayIndexKey: 上の理由
              <li key={index}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-analytics-link="social"
                  className={footerLink}
                >
                  {socialLinkName(link)}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </footer>
  )
}

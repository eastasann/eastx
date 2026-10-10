/**
 * トップのプロフィール（design-spec 6.1.4）。先頭に一言を大きく出し、その下に写真（なければ名前の頭文字の丸）を名前の横に置き、肩書き・自己紹介・SNS リンクのアイコン。
 * プロフィールは言語ラベル・注記を出さず、項目単位の代替表示だけで出す（design-spec 1.4）
 */
import { css } from 'styled-system/css'
import type { ProfileView } from '~/content/types'
import type { Lang } from '~/i18n/detect'
import type { Messages } from '~/i18n/messages'
import { SocialIcon } from '~/ui/brand-icons'
import { FallbackImage, InitialBadge } from '~/ui/image'
import { MarkdownBody } from '~/ui/markdown-body'
import { button } from '~/ui/recipes'
import { Text } from './content-parts'
import { socialLinkName } from './site-footer'

const avatar = css({ w: 'avatar-sm', aspectRatio: 'avatar', borderRadius: 'avatar', flexShrink: 0 })

/** 自己紹介はグレーの本文にし、太字（固有名詞）とリンクだけを濃い色にする（design-spec 4.4） */
const bio = css({ color: 'text.muted', '& strong': { color: 'text.default' } })

export function ProfileSection({ profile, lang, messages }: { profile: ProfileView; lang: Lang; messages: Messages }) {
  const name = profile.name?.value ?? ''
  const initial = <InitialBadge name={name} size="avatar" />
  return (
    <section
      id="profile"
      aria-label={messages.section.profile}
      className={css({ display: 'flex', flexDirection: 'column', gap: 'stack' })}
    >
      {profile.tagline && (
        // ページの見出し（h1）は名前のままにする
        <Text
          as="p"
          text={profile.tagline}
          pageLang={lang}
          className={css({ textStyle: 'display', color: 'text.default', overflowWrap: 'anywhere' })}
        />
      )}
      <div className={css({ display: 'flex', flexDirection: 'column', gap: 'stack-dense' })}>
        <div className={css({ display: 'flex', alignItems: 'center', gap: 'inset' })}>
          {profile.avatarUrl === null ? (
            initial
          ) : (
            <FallbackImage src={profile.avatarUrl} alt={name} className={avatar} loading="eager" fallback={initial} />
          )}
          <div className={css({ display: 'flex', flexDirection: 'column', minW: '[0]' })}>
            {/* トップの見出しは名前。名前がないプロフィールは公開のルールで起きない（profile_name_required） */}
            {profile.name && (
              <Text as="h1" text={profile.name} pageLang={lang} className={css({ textStyle: 'heading-2' })} />
            )}
            {profile.headline && (
              <Text as="p" text={profile.headline} pageLang={lang} className={css({ color: 'text.muted' })} />
            )}
          </div>
        </div>
        {profile.bio && (
          <MarkdownBody
            html={profile.bio.html}
            copyLabels={messages.code}
            lang={profile.bio.lang === lang ? undefined : profile.bio.lang}
            className={bio}
          />
        )}
        {profile.socialLinks.length > 0 && (
          <ul aria-label={messages.footer.social} className={css({ display: 'flex', flexWrap: 'wrap', gap: 'inline' })}>
            {profile.socialLinks.map((link, index) => {
              const label = socialLinkName(link)
              return (
                // 同じ URL を2回登録できるので、並びの位置で区別する（src/site/site-footer.tsx と同じ）
                // biome-ignore lint/suspicious/noArrayIndexKey: 上の理由
                <li key={index}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-analytics-link="social"
                    // other は汎用のリンクアイコンと表示名（design-spec 6.1.4）。それ以外はアイコンだけで、読み上げ名はサービス名
                    aria-label={link.service === 'other' ? undefined : label}
                    title={link.service === 'other' ? undefined : label}
                    className={button({ variant: 'ghost', shape: link.service === 'other' ? 'default' : 'icon' })}
                  >
                    <SocialIcon service={link.service} />
                    {link.service === 'other' && <span>{label}</span>}
                  </a>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

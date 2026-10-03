/**
 * 公開側の中身の部品（design-spec 6.1.4・6.2.2）。トップのカード・行と詳細ページで共通
 */
import { css, cx } from 'styled-system/css'
import type { Availability, LocalizedText } from '~/content/localize'
import type { StackChip } from '~/content/types'
import type { Lang } from '~/i18n/detect'
import type { Messages } from '~/i18n/messages'
import { ExternalLinkIcon } from '~/ui/icons'
import { FallbackImage, InitialBadge } from '~/ui/image'
import { chip, label } from '~/ui/recipes'

/** カードのアイコンの列に出す使用技術の数（design-spec 6.1.4）。超えた分は「+N」 */
export const MAX_CARD_STACKS = 6

/**
 * 代替した文字列。表示中の言語と違う言語の値には、その部分の言語を付ける（design-spec 1.4・SDD 9章）。
 * as は、ブロックで出すとき（見出し・段落）に使う
 */
export function Text({
  text,
  pageLang,
  as: Tag = 'span',
  className,
}: {
  text: LocalizedText
  pageLang: Lang
  as?: 'span' | 'p' | 'h1' | 'h2' | 'h3'
  className?: string
}) {
  return (
    <Tag lang={text.lang === pageLang ? undefined : text.lang} className={className}>
      {text.value}
    </Tag>
  )
}

/** 表示中の言語で「言語あり」でない中身の言語ラベル（「英語のみ」／「Japanese only」） */
export function LanguageLabel({ availability, messages }: { availability: Availability; messages: Messages }) {
  if (!availability.fallback) return null
  return <span className={label()}>{messages.label.onlyIn(availability.lang)}</span>
}

/** 別タブで開くリンクの印。読み上げ名は「別タブで開く」 */
export function ExternalMark({ messages }: { messages: Messages }) {
  return (
    <span className={css({ display: 'inline-flex', color: 'text.muted' })}>
      <ExternalLinkIcon size="sm" />
      <span className={css({ srOnly: true })}>{messages.label.opensInNewTab}</span>
    </span>
  )
}

const stackIcon = css({ w: 'icon', h: 'icon', aspectRatio: 'avatar', objectFit: 'contain' })

/**
 * 技術のアイコン。アイコンがない・読み込めない技術は、表示名の頭文字の丸（design-spec 6.1.4）。
 * `labelled` はアイコンだけで技術を伝える場所（カードのアイコンの列）で付け、代替テキストを表示名にする（design-spec 4.4）。
 * チップのように表示名が隣に出る場所では付けず、同じ名前を2回読み上げないようにする
 */
export function StackIcon({ stack, labelled = false }: { stack: StackChip; labelled?: boolean }) {
  const fallback = (
    <>
      <InitialBadge name={stack.displayName} size="icon" />
      {labelled && <span className={css({ srOnly: true })}>{stack.displayName}</span>}
    </>
  )
  if (stack.iconUrl === null) return fallback
  return (
    <FallbackImage
      src={stack.iconUrl}
      alt={labelled ? stack.displayName : ''}
      className={stackIcon}
      fallback={fallback}
    />
  )
}

/** カードの使用技術のアイコンの列。その中身の中での並び順で最大6個、超えた分は「+N」 */
export function StackIconRow({ stacks, messages }: { stacks: StackChip[]; messages: Messages }) {
  if (stacks.length === 0) return null
  const shown = stacks.slice(0, MAX_CARD_STACKS)
  const rest = stacks.length - shown.length
  return (
    <ul
      aria-label={messages.section.stack}
      className={css({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'inline' })}
    >
      {shown.map((stack) => (
        // 表示名はポインターを重ねたときにも出す
        <li key={stack.key} title={stack.displayName} className={css({ display: 'inline-flex' })}>
          <StackIcon stack={stack} labelled />
        </li>
      ))}
      {rest > 0 && (
        <li className={css({ textStyle: 'label', color: 'text.muted' })}>
          <span aria-hidden="true">+{rest}</span>
          <span className={css({ srOnly: true })}>{messages.label.moreStacks(rest)}</span>
        </li>
      )}
    </ul>
  )
}

/** 使用技術のチップ（アイコンと表示名）。リンクがあれば公式サイトなどを別タブで開く */
export function StackChipList({
  stacks,
  messages,
  className,
}: {
  stacks: StackChip[]
  messages: Messages
  className?: string
}) {
  if (stacks.length === 0) return null
  return (
    <ul
      aria-label={messages.section.stack}
      className={cx(css({ display: 'flex', flexWrap: 'wrap', gap: 'inline' }), className)}
    >
      {stacks.map((stack) => {
        const content = (
          <>
            <StackIcon stack={stack} />
            <span>{stack.displayName}</span>
          </>
        )
        return (
          <li key={stack.key}>
            {stack.linkUrl === null ? (
              <span className={chip()}>{content}</span>
            ) : (
              <a
                href={stack.linkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cx(chip({ interactive: true }), css({ textDecoration: 'none' }))}
              >
                {content}
                <ExternalMark messages={messages} />
              </a>
            )}
          </li>
        )
      })}
    </ul>
  )
}

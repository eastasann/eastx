/**
 * 公開側の中身の部品（design-spec 6.1.4・6.2.2）。トップの行と詳細ページで共通
 */
import { useId } from 'react'
import { css, cx } from 'styled-system/css'
import type { Availability, LocalizedText } from '~/content/localize'
import type { StackChip } from '~/content/types'
import type { Lang } from '~/i18n/detect'
import type { Messages } from '~/i18n/messages'
import { SECTION_NAME_LANG } from '~/i18n/section-names'
import { ExternalLinkIcon } from '~/ui/icons'
import { FallbackImage, InitialBadge } from '~/ui/image'
import { chip, label } from '~/ui/recipes'

/** 閉じた行の右のアイコンの列に出す使用技術の数（design-spec 6.1.4）。超えた分は「+N」。広げた中には全部を出す */
export const MAX_ROW_STACKS = 3

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
 * `labelled` はアイコンだけで技術を伝える場所（行のアイコンの列）で付け、代替テキストを表示名にする（design-spec 4.4）。
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

/**
 * 使用技術の並びの読み上げの名前（Tech Stack）。セクションの名前なので英語の発音で読ませる。aria-label では lang が
 * 効かないので、隠した要素を aria-labelledby で指す
 */
function StackListName({ id, messages }: { id: string; messages: Messages }) {
  return (
    <span id={id} lang={SECTION_NAME_LANG} hidden>
      {messages.section.stack}
    </span>
  )
}

/**
 * 使用技術のアイコンの列。その中身の中での並び順で、`max` を渡したときは最大 max 個まで出して超えた分を「+N」、
 * 渡さないときは全部を折り返して出す。`inButton` は行のボタンの中に置くときに付け、`ul` の代わりに `span` で組む
 * （`button` の中身はフレージング内容だけ）
 */
export function StackIconRow({
  stacks,
  max,
  inButton = false,
  messages,
}: {
  stacks: StackChip[]
  max?: number
  inButton?: boolean
  messages: Messages
}) {
  const labelId = useId()
  if (stacks.length === 0) return null
  const shown = max === undefined ? stacks : stacks.slice(0, max)
  const rest = stacks.length - shown.length
  const List = inButton ? 'span' : 'ul'
  const Item = inButton ? 'span' : 'li'
  return (
    <>
      <StackListName id={labelId} messages={messages} />
      <List
        role={inButton ? 'group' : undefined}
        aria-labelledby={labelId}
        className={css({
          display: 'flex',
          flexWrap: max === undefined ? 'wrap' : 'nowrap',
          alignItems: 'center',
          gap: 'inline',
        })}
      >
        {shown.map((stack) => (
          // 表示名はポインターを重ねたときにも出す
          <Item key={stack.key} title={stack.displayName} className={css({ display: 'inline-flex' })}>
            <StackIcon stack={stack} labelled />
          </Item>
        ))}
        {rest > 0 && (
          <Item className={css({ textStyle: 'label', color: 'text.muted' })}>
            <span aria-hidden="true">+{rest}</span>
            <span className={css({ srOnly: true })}>{messages.label.moreStacks(rest)}</span>
          </Item>
        )}
      </List>
    </>
  )
}

/** 使用技術のチップ（アイコンと表示名。枠線なし）。リンクがあれば公式サイトなどを別タブで開く */
export function StackChipList({
  stacks,
  messages,
  className,
}: {
  stacks: StackChip[]
  messages: Messages
  className?: string
}) {
  const labelId = useId()
  if (stacks.length === 0) return null
  return (
    <>
      <StackListName id={labelId} messages={messages} />
      <ul
        aria-labelledby={labelId}
        className={cx(css({ display: 'flex', flexWrap: 'wrap', columnGap: 'inset', rowGap: 'inline' }), className)}
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
                <span className={chip({ plain: true })}>{content}</span>
              ) : (
                <a
                  href={stack.linkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cx(chip({ interactive: true, plain: true }), css({ textDecoration: 'none' }))}
                >
                  {content}
                  <ExternalMark messages={messages} />
                </a>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}

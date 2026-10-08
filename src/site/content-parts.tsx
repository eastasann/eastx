/**
 * 公開側の中身の部品（design-spec 6.1.4・6.2.2）。トップの行と詳細ページで共通
 */
import { type ReactNode, useId } from 'react'
import { css, cx } from 'styled-system/css'
import type { Availability, LocalizedText } from '~/content/localize'
import type { StackChip, TopPageView } from '~/content/types'
import { initialOf } from '~/domain/initial'
import type { Lang } from '~/i18n/detect'
import type { Messages } from '~/i18n/messages'
import { SECTION_NAME_LANG, STACK_GROUP_NAMES } from '~/i18n/section-names'
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

const stackIcon = css({ w: 'icon', h: 'icon', aspectRatio: 'avatar' })

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
      fit="contain"
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

const chipList = css({ display: 'flex', flexWrap: 'wrap', columnGap: 'inset', rowGap: 'inline' })

/** チップ1つ（アイコンと表示名。枠線なし）。リンクがあれば公式サイトなどを別タブで開く */
function StackChipItem({ stack, icon, messages }: { stack: StackChip; icon: ReactNode; messages: Messages }) {
  const content = (
    <>
      {icon}
      <span>{stack.displayName}</span>
    </>
  )
  return (
    <li>
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
}

/** 使用技術のチップの並び（P2・P3） */
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
      <ul aria-labelledby={labelId} className={cx(chipList, className)}>
        {stacks.map((stack) => (
          <StackChipItem key={stack.key} stack={stack} icon={<StackIcon stack={stack} />} messages={messages} />
        ))}
      </ul>
    </>
  )
}

/** Tech Stack のアイコンの地つきの正方形の枠。アイコンでも頭文字でも同じ大きさにする（design-spec 6.1.4） */
const framedIcon = css({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  p: 'inset-dense',
  bg: 'bg.subtle',
  borderRadius: 'control',
})

/** 枠の中身。縦横比・余白・色がまちまちな画像を、同じ大きさのグレースケールにそろえる（ADR-014 の例外） */
const framedImage = css({
  display: 'block',
  w: 'icon',
  h: 'icon',
  filter: 'auto',
  grayscale: '100%',
})

const framedInitial = css({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  w: 'icon',
  h: 'icon',
  textStyle: 'label',
  color: 'text.muted',
  userSelect: 'none',
})

/** Tech Stack のアイコン。アイコンが無い・読み込めない技術は、同じ枠の中に頭文字を出す。表示名が隣にあるので読み上げない */
function FramedStackIcon({ stack }: { stack: StackChip }) {
  const initial = (
    <span aria-hidden="true" className={framedInitial}>
      {initialOf(stack.displayName)}
    </span>
  )
  return (
    <span data-tech-stack-icon="" className={framedIcon}>
      {stack.iconUrl === null ? (
        initial
      ) : (
        <FallbackImage src={stack.iconUrl} alt="" className={framedImage} fit="contain" fallback={initial} />
      )}
    </span>
  )
}

/**
 * P1 の Tech Stack（design-spec 6.1.4）。群ごとに見出しとチップのリストを出す。群の名前は日英共通の英語なので、
 * /ja でも英語の発音で読ませる
 */
export function TechStackGroups({ groups, messages }: { groups: TopPageView['stackGroups']; messages: Messages }) {
  const baseId = useId()
  return (
    <div className={css({ display: 'flex', flexDirection: 'column', gap: 'stack' })}>
      {groups.map((group) => {
        const headingId = `${baseId}-${group.key}`
        return (
          <div key={group.key} className={css({ display: 'flex', flexDirection: 'column', gap: 'stack-dense' })}>
            <h3 id={headingId} lang={SECTION_NAME_LANG} className={css({ textStyle: 'label', color: 'text.muted' })}>
              {STACK_GROUP_NAMES[group.key]}
            </h3>
            <ul aria-labelledby={headingId} className={chipList}>
              {group.stacks.map((stack) => (
                <StackChipItem
                  key={stack.key}
                  stack={stack}
                  icon={<FramedStackIcon stack={stack} />}
                  messages={messages}
                />
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

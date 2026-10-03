/**
 * トップのセクション内ページング（design-spec 6.1.3）。経歴・プロジェクト・作品・ブログ・コーディング記録で共通。
 * - 縦に5件ずつ。全件を最初から描いておき、切り替えは待ち時間なしで、横にスライドする
 * - 全ページを grid の同じ升目に重ねるので、セクションの高さは一番高いページに揃う
 * - ページ番号は URL に載せず、履歴ごとに覚える（ブラウザの「戻る」で戻すため。src/site/page-memory.ts）
 */
import { useLocation } from '@tanstack/react-router'
import { type KeyboardEvent, type PointerEvent, type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { css, cx } from 'styled-system/css'
import type { Messages } from '~/i18n/messages'
import { ChevronLeftIcon, ChevronRightIcon } from '~/ui/icons'
import { button } from '~/ui/recipes'
import type { PagedSectionId } from './history-state'
import { readSavedPages, savePage } from './page-memory'

export const PAGE_SIZE = 5

/** 横スワイプとみなす移動量（px）。縦のスクロールと区別するため、横の移動が縦より大きいことも条件にする */
const SWIPE_THRESHOLD = 40

export interface PagedSectionProps<T extends { id: string }> {
  id: PagedSectionId
  title: string
  /** 並び順のとおり（design-spec 6.1.3）。id は戻るリンクの `itemId`（SDD 4.1） */
  items: T[]
  renderItem: (item: T) => ReactNode
  messages: Messages
}

function chunk<T>(items: T[]): T[][] {
  const pages: T[][] = []
  for (let i = 0; i < items.length; i += PAGE_SIZE) pages.push(items.slice(i, i + PAGE_SIZE))
  return pages
}

function clampPage(page: number, pageCount: number): number {
  return Math.min(Math.max(1, Math.trunc(page)), Math.max(1, pageCount))
}

export function PagedSection<T extends { id: string }>({
  id,
  title,
  items,
  renderItem,
  messages,
}: PagedSectionProps<T>) {
  const location = useLocation()
  const pages = chunk(items)
  const pageCount = pages.length
  const [page, setPage] = useState(1)
  // 項目の key に入れる。ページを切り替えたら項目を作り直し、広げた「続きを読む」を閉じる（design-spec 6.1.3）
  const [generation, setGeneration] = useState(0)
  const [animated, setAnimated] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const swipeStart = useRef<{ x: number; y: number } | null>(null)

  // 履歴が変わったときのページ（hydrate のあと・描画の前に合わせる。サーバーは履歴を知らず1ページ目で描く）:
  // - ブラウザの「戻る」「進む」で来た: その履歴で離れたときのページ
  // - 詳細ページの戻るリンクで来た: その項目を含むページ（来たあとにページングしていれば、上の離れたときのページ）
  // - 言語の切り替えなど、別のパスから来た: 1ページ目（design-spec 1.4）
  // - トップの中でセクションへ移った（ハッシュだけが変わった）: 今のページのまま
  const { pathname } = location
  const { section, itemId, __TSR_key: entryKey } = location.state
  const shownPath = useRef<string | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 履歴（entryKey）が変わったときだけ合わせ直す。items・page は同じ履歴の中の値を読む
  useLayoutEffect(() => {
    const samePath = shownPath.current === pathname
    shownPath.current = pathname
    const saved = entryKey === undefined ? undefined : readSavedPages(entryKey)[id]
    const index = section === id && itemId !== undefined ? items.findIndex((item) => item.id === itemId) : -1
    setAnimated(false)
    setAnnouncement('')
    if (saved !== undefined) setPage(clampPage(saved, pageCount))
    else if (index >= 0) setPage(Math.floor(index / PAGE_SIZE) + 1)
    else if (!samePath) setPage(1)
    else if (page > 1 && entryKey !== undefined) savePage(entryKey, id, page)
  }, [entryKey])

  if (pageCount === 0) return null

  const go = (target: number) => {
    const next = clampPage(target, pageCount)
    if (next === page) return
    setPage(next)
    setGeneration((g) => g + 1)
    setAnimated(true)
    setAnnouncement(messages.paging.announce(next, pageCount))
    if (entryKey !== undefined) savePage(entryKey, id, next)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft') go(page - 1)
    else if (event.key === 'ArrowRight') go(page + 1)
    else return
    event.preventDefault()
  }

  const onPointerDown = (event: PointerEvent) => {
    swipeStart.current = event.pointerType === 'touch' ? { x: event.clientX, y: event.clientY } : null
  }
  const onPointerUp = (event: PointerEvent) => {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return
    go(dx < 0 ? page + 1 : page - 1)
  }

  const headingId = `${id}-heading`
  const paged = pageCount > 1

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={css({ display: 'flex', flexDirection: 'column', gap: 'stack' })}
    >
      <div className={css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'inline' })}>
        <h2 id={headingId} className={css({ textStyle: 'heading-2' })}>
          {title}
        </h2>
        {paged && (
          // 端のボタンは disabled ではなく aria-disabled で無効にする。disabled にすると、押してフォーカスがあるボタンが
          // 端で無効になったときにフォーカスが外れ、キーボードの ← → が効かなくなる（go は範囲の外を無視する）
          // biome-ignore lint/a11y/useSemanticElements: ボタンとページ表示のまとまり。fieldset はフォームの部品ではないので使わない
          <div
            role="group"
            aria-label={messages.paging.controls(title)}
            onKeyDown={onKeyDown}
            className={css({ display: 'flex', alignItems: 'center', gap: 'inline' })}
          >
            <button
              type="button"
              aria-label={messages.paging.previous}
              aria-disabled={page === 1}
              onClick={() => go(page - 1)}
              className={button({ variant: 'ghost', shape: 'icon' })}
            >
              <ChevronLeftIcon />
            </button>
            <span className={css({ textStyle: 'meta', color: 'text.muted', whiteSpace: 'nowrap' })}>
              {messages.paging.position(page, pageCount)}
            </span>
            <button
              type="button"
              aria-label={messages.paging.next}
              aria-disabled={page === pageCount}
              onClick={() => go(page + 1)}
              className={button({ variant: 'ghost', shape: 'icon' })}
            >
              <ChevronRightIcon />
            </button>
          </div>
        )}
      </div>
      {paged && (
        <p aria-live="polite" className={css({ srOnly: true })}>
          {announcement}
        </p>
      )}
      <div
        onPointerDown={paged ? onPointerDown : undefined}
        onPointerUp={paged ? onPointerUp : undefined}
        onPointerCancel={() => {
          swipeStart.current = null
        }}
        className={css({ display: 'grid', overflowX: 'clip', touchAction: 'pan-y' })}
      >
        {pages.map((pageItems, index) => {
          const number = index + 1
          const position = number < page ? 'before' : number > page ? 'after' : 'current'
          return (
            <ul
              // biome-ignore lint/suspicious/noArrayIndexKey: ページは件数で区切った位置そのもので、並べ替わらない
              key={index}
              inert={position !== 'current'}
              data-position={position}
              className={cx(
                css({
                  gridRow: '1',
                  gridColumn: '1',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'stack-dense',
                  translate: 'auto',
                  '&[data-position=before]': { translateX: '-full', visibility: 'hidden' },
                  '&[data-position=after]': { translateX: 'full', visibility: 'hidden' },
                }),
                animated &&
                  css({
                    // visibility も移すと、隠れるページはスライドが終わるまで見えたまま残る
                    transitionProperty: 'translate, visibility',
                    transitionDuration: 'motion.paging',
                    transitionTimingFunction: 'motion.paging',
                    // OS の「視差効果を減らす」ではアニメーションなしで切り替える（design-spec 4.4）
                    _motionReduce: { transitionProperty: 'none' },
                  }),
              )}
            >
              {pageItems.map((item) => (
                <li key={`${generation}:${item.id}`}>{renderItem(item)}</li>
              ))}
            </ul>
          )
        })}
      </div>
    </section>
  )
}

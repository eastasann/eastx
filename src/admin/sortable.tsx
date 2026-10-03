/**
 * フォームの中の並べ替え（SNS リンク、作品・プロジェクトの使用技術のチップ。design-spec 6.7.2）。dnd-kit でドラッグとキーボードで並べ替える（ADR-015）。
 * 一覧ビューの行の並べ替えは src/admin/list-view.tsx が持つ
 */
import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { CSSProperties, ReactNode } from 'react'
import { css, cx } from 'styled-system/css'
import { GripIcon } from '~/ui/icons'
import { button } from '~/ui/recipes'

export const SORT_INSTRUCTIONS =
  'スペースキーで持ち上げ、上下の矢印キーで動かし、もう一度スペースキーで置きます。Esc でやめます'

/** 横に並べて折り返す並び（チップ）は、左右の矢印キーでも動く */
const WRAP_SORT_INSTRUCTIONS =
  'スペースキーで持ち上げ、矢印キーで動かし、もう一度スペースキーで置きます。Esc でやめます'

export interface SortableListProps<T> {
  items: T[]
  getId: (item: T) => string
  /** 読み上げに使う項目の名前 */
  getLabel: (item: T, index: number) => string
  onMove: (from: number, to: number) => void
  /** handle は並べ替えのつまみ。項目の中の好きな場所に置く */
  renderItem: (item: T, index: number, handle: ReactNode) => ReactNode
  /** 並びの読み上げ名 */
  label: string
  /** `column` は縦に1列（SNS リンク）、`wrap` は横に並べて折り返す（チップ） */
  layout?: 'column' | 'wrap'
}

const listLayouts = {
  column: css({ display: 'flex', flexDirection: 'column', gap: 'inline' }),
  wrap: css({ display: 'flex', flexWrap: 'wrap', gap: 'inline' }),
}

export function SortableList<T>({
  items,
  getId,
  getLabel,
  onMove,
  renderItem,
  label,
  layout = 'column',
}: SortableListProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const ids = items.map(getId)
  const indexOf = (id: UniqueIdentifier) => ids.indexOf(String(id))
  const nameOf = (id: UniqueIdentifier) => {
    const index = indexOf(id)
    const item = items[index]
    return item === undefined ? '' : `「${getLabel(item, index)}」`
  }
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${nameOf(active.id)}を持ち上げました`,
    onDragOver: ({ active, over }) =>
      over ? `${nameOf(active.id)}を${indexOf(over.id) + 1}番目へ動かしました` : `${nameOf(active.id)}は並びの外です`,
    onDragEnd: ({ active, over }) =>
      over ? `${nameOf(active.id)}を${indexOf(over.id) + 1}番目に置きました` : `${nameOf(active.id)}を元に戻しました`,
    onDragCancel: ({ active }) => `${nameOf(active.id)}の並べ替えをやめました`,
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (over === null || active.id === over.id) return
    onMove(indexOf(active.id), indexOf(over.id))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: layout === 'column' ? SORT_INSTRUCTIONS : WRAP_SORT_INSTRUCTIONS },
      }}
    >
      <SortableContext items={ids} strategy={layout === 'column' ? verticalListSortingStrategy : rectSortingStrategy}>
        <ul aria-label={label} className={listLayouts[layout]}>
          {items.map((item, index) => (
            <SortableItem key={getId(item)} id={getId(item)} label={getLabel(item, index)}>
              {(handle) => renderItem(item, index, handle)}
            </SortableItem>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}

// dnd-kit が実行時に渡す位置と遷移は CSS 変数で受ける（ADR-014 のトークンを通さない値の例外）
const sortableItem = css({
  position: 'relative',
  bg: 'surface.default',
  transform: 'var(--drag-transform)',
  transition: 'var(--drag-transition)',
  '&[data-dragging=true]': { boxShadow: 'drag', zIndex: 'overlay' },
})

function SortableItem({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: (handle: ReactNode) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  const style = {
    '--drag-transform': CSS.Translate.toString(transform) ?? 'none',
    '--drag-transition': transition ?? 'none',
  } as CSSProperties
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={`「${label}」を並べ替える`}
      className={cx(button({ variant: 'ghost', shape: 'icon' }), css({ cursor: 'grab', touchAction: 'none' }))}
    >
      <GripIcon size="sm" />
    </button>
  )
  return (
    <li ref={setNodeRef} style={style} data-dragging={isDragging} className={sortableItem}>
      {children(handle)}
    </li>
  )
}

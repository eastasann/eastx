/**
 * フォームの中の並べ替え（SNS リンク、作品・プロジェクトの使用技術のチップ。design-spec 6.7.2）。dnd-kit でドラッグとキーボードで並べ替える（ADR-015）。
 * 一覧ビューの行の並べ替えは src/admin/list-view.tsx が持つ
 */
import {
  type Announcements,
  type CollisionDetection,
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  rectIntersection,
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

/**
 * 横に並べて折り返す並び（幅の違う項目が複数の行にわたる）の当たり判定。矢印キーで動かすと、持ち上げた項目の左上が
 * 行き先の項目の左上に重なる。中心の近さ（closestCenter）や重なりの大きさだけで選ぶと、幅の広い項目は、元の自分の位置や
 * 行き先の隣の項目の方を選んで、行き先へ動かない。重なっている項目のうち左上の角が最も近いものを選び、どれにも
 * 重ならないとき（ポインターで隙間に持っていったとき）だけ中心の近さで選ぶ
 */
export const wrapCollision: CollisionDetection = (args) => {
  const intersecting = rectIntersection(args)
  if (intersecting.length === 0) return closestCenter(args)
  const { collisionRect, droppableRects } = args
  const distanceOf = (id: UniqueIdentifier) => {
    const rect = droppableRects.get(id)
    return rect === undefined
      ? Number.POSITIVE_INFINITY
      : Math.hypot(rect.left - collisionRect.left, rect.top - collisionRect.top)
  }
  return intersecting
    .map((collision) => ({ ...collision, data: { ...collision.data, value: distanceOf(collision.id) } }))
    .sort((a, b) => a.data.value - b.data.value)
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
      collisionDetection={layout === 'column' ? closestCenter : wrapCollision}
      onDragEnd={handleDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: layout === 'column' ? SORT_INSTRUCTIONS : WRAP_SORT_INSTRUCTIONS },
      }}
    >
      <SortableContext items={ids} strategy={layout === 'column' ? verticalListSortingStrategy : rectSortingStrategy}>
        <ul aria-label={label} className={listLayouts[layout]}>
          {items.map((item, index) => (
            <SortableItem key={getId(item)} id={getId(item)} label={getLabel(item, index)} compact={layout === 'wrap'}>
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
  transform: 'var(--drag-transform)',
  transition: 'var(--drag-transition)',
  // 持ち上げているあいだだけ地を付け、下の項目と重なっても読めるようにする
  '&[data-dragging=true]': { bg: 'surface.default', boxShadow: 'drag', zIndex: 'overlay' },
})

function SortableItem({
  id,
  label,
  compact,
  children,
}: {
  id: string
  label: string
  /** 横に並べる小さな項目（使用技術）のつまみ */
  compact: boolean
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
      className={cx(
        button({ variant: 'ghost', shape: compact ? 'compact' : 'icon' }),
        css({ cursor: 'grab', touchAction: 'none' }),
      )}
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

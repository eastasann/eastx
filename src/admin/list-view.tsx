/**
 * 管理画面の一覧ビュー（design-spec 6.6。A4〜A9 で共通）。行を押すと編集ビュー、「⋯」から公開サイトで見る・削除。
 * 並べ替えを持つ一覧（作品・プロジェクト・使用技術）は dnd-kit でドラッグとキーボードで並べ替え、その場で保存する（ADR-015）
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
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useRouter } from '@tanstack/react-router'
import { type CSSProperties, type MouseEvent, type ReactNode, useState } from 'react'
import { css, cx } from 'styled-system/css'
import { GripIcon, MoreIcon, PlusIcon } from '~/ui/icons'
import { Menu } from '~/ui/menu'
import { button } from '~/ui/recipes'
import { toaster } from '~/ui/toast'
import { MEDIA, useMediaQuery } from '~/ui/use-media-query'
import { ConfirmDialog } from './confirm-dialog'
import { isAuthError } from './errors'
import { NOTICES } from './labels'
import { AdminLink } from './link'
import { SORT_INSTRUCTIONS } from './sortable'
import { LoadError, Skeleton } from './states'

export interface Column<T> {
  key: string
  header: string
  cell: (item: T) => ReactNode
  /** モバイル幅でも残す列（タイトル・状態。design-spec 6.6） */
  mobile?: boolean
  /** 編集ビューへのリンクにする列（タイトル） */
  primary?: boolean
}

export interface ListQuery<T> {
  status: 'pending' | 'error' | 'success'
  data: T[] | undefined
  refetch: () => unknown
}

export interface AdminListProps<T> {
  /** テーブルの読み上げ名（「経歴の一覧」） */
  label: string
  query: ListQuery<T>
  columns: Column<T>[]
  getId: (item: T) => string
  /** 削除の確認ダイアログと、並べ替えの読み上げに出す名前 */
  getTitle: (item: T) => string
  editHref: (item: T) => string
  /** 公開中のものだけ、公開サイトの行き先を返す（それ以外は null）。省くと「公開サイトで見る」を出さない */
  publicHref?: (item: T) => string | null
  /** 削除の確認の文。省くと「『{タイトル}』を削除します。元に戻せません」 */
  deleteMessage?: (item: T) => string
  /** 失敗したら投げる。成功したら一覧を読み直すのは呼び出し側 */
  onDelete: (item: T) => Promise<void>
  /** 並べ替え。失敗したら投げる（並びを元に戻して通知する） */
  reorder?: { disabled: boolean; save: (ids: string[]) => Promise<void> }
  /** 絞り込み中か。0件の表示を変える */
  filtered: boolean
  onClearFilter?: () => void
  newHref: string
}

const table = css({ w: '[100%]', borderCollapse: 'collapse', textStyle: 'body-sm' })
const headCell = css({
  textAlign: 'start',
  textStyle: 'label',
  color: 'text.muted',
  px: 'inset-dense',
  py: 'inset-dense',
  borderBottomWidth: 'default',
  borderBottomStyle: 'solid',
  borderBottomColor: 'border.default',
  whiteSpace: 'nowrap',
})
const cell = css({
  px: 'inset-dense',
  py: 'inset-dense',
  borderBottomWidth: 'default',
  borderBottomStyle: 'solid',
  borderBottomColor: 'border.default',
  verticalAlign: 'middle',
})
const row = css({ bg: 'surface.default', cursor: 'pointer', _hover: { bg: 'bg.subtle' } })
// dnd-kit が実行時に渡す位置と遷移は CSS 変数で受ける（ADR-014 のトークンを通さない値の例外）
const sortableRow = css({
  position: 'relative',
  transform: 'var(--drag-transform)',
  transition: 'var(--drag-transition)',
  '&[data-dragging=true]': { boxShadow: 'drag', zIndex: 'overlay' },
})
const primaryLink = css({
  color: 'text.default',
  textStyle: 'ui',
  textDecoration: 'none',
  _hover: { textDecoration: 'underline' },
})
const iconButton = button({ variant: 'ghost', shape: 'icon' })

/** 行の中のボタン・リンク・メニューを押したときは、行の移動を起こさない */
function fromControl(event: MouseEvent): boolean {
  return event.target instanceof Element && event.target.closest('a, button, [role=menu], [role=menuitem]') !== null
}

export function AdminList<T>(props: AdminListProps<T>) {
  const { label, query, columns, getId, getTitle, filtered, onClearFilter, newHref, reorder } = props
  const isMobile = useMediaQuery(MEDIA.mobile)
  const shown = isMobile ? columns.filter((column) => column.mobile) : columns
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null)
  // 保存の途中で次の並べ替えを受けると、要求が前後して画面とサーバーの並びがずれうるので、終わるまで止める
  const [savingOrder, setSavingOrder] = useState(false)
  const [deleting, setDeleting] = useState<{ item: T; pending: boolean } | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  if (query.status === 'pending') {
    return (
      <table aria-label={label} aria-busy="true" className={table}>
        <tbody>
          {Array.from({ length: 5 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 中身のない形だけの行で、並びは変わらない
            <tr key={index}>
              <td className={cell}>
                <Skeleton />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  if (query.status === 'error' || query.data === undefined) return <LoadError onRetry={() => query.refetch()} />

  const data = query.data
  if (data.length === 0) {
    return filtered ? (
      <div className={css({ display: 'flex', alignItems: 'center', gap: 'inline', py: 'inset' })}>
        <p className={css({ textStyle: 'body-sm', color: 'text.muted' })}>条件に合うものがありません</p>
        {onClearFilter && (
          <button type="button" onClick={onClearFilter} className={button({ variant: 'outline' })}>
            絞り込みを解除
          </button>
        )}
      </div>
    ) : (
      <div
        className={css({
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 'inline',
          py: 'inset',
        })}
      >
        <p className={css({ textStyle: 'body-sm', color: 'text.muted' })}>
          まだありません。「新規作成」から追加できます
        </p>
        <AdminLink href={newHref} className={cx(button(), css({ textDecoration: 'none' }))}>
          <PlusIcon size="sm" />
          新規作成
        </AdminLink>
      </div>
    )
  }

  const byId = new Map(data.map((item) => [getId(item), item]))
  const items = optimisticOrder
    ? optimisticOrder.flatMap((id) => {
        const item = byId.get(id)
        return item === undefined ? [] : [item]
      })
    : data
  const ids = items.map(getId)
  const titleOf = (id: UniqueIdentifier) => {
    const item = byId.get(String(id))
    return item === undefined ? '' : `「${getTitle(item)}」`
  }
  const positionOf = (id: UniqueIdentifier | undefined) => (id === undefined ? 0 : ids.indexOf(String(id)) + 1)

  const announcements: Announcements = {
    onDragStart: ({ active }) => `${titleOf(active.id)}を持ち上げました`,
    onDragOver: ({ active, over }) =>
      over ? `${titleOf(active.id)}を${positionOf(over.id)}番目へ動かしました` : `${titleOf(active.id)}は並びの外です`,
    onDragEnd: ({ active, over }) =>
      over ? `${titleOf(active.id)}を${positionOf(over.id)}番目に置きました` : `${titleOf(active.id)}を元に戻しました`,
    onDragCancel: ({ active }) => `${titleOf(active.id)}の並べ替えをやめました`,
  }

  async function handleDragEnd({ active, over }: DragEndEvent) {
    if (!reorder || over === null || active.id === over.id) return
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))
    setOptimisticOrder(next)
    setSavingOrder(true)
    try {
      await reorder.save(next)
      toaster.create({ title: NOTICES.reordered, type: 'success' })
    } catch (error) {
      if (!isAuthError(error)) toaster.create({ title: NOTICES.reorderFailed, type: 'error' })
    } finally {
      // 成功したときは呼び出し側が一覧のデータを新しい並びにしている。失敗したときは元の並びに戻る
      setOptimisticOrder(null)
      setSavingOrder(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setDeleting({ ...deleting, pending: true })
    try {
      await props.onDelete(deleting.item)
      toaster.create({ title: NOTICES.deleted, type: 'success' })
    } catch (error) {
      if (!isAuthError(error)) toaster.create({ title: NOTICES.deleteFailed, type: 'error' })
    }
    setDeleting(null)
  }

  const sortable = reorder !== undefined
  const rows = items.map((item) => (
    <ListRow
      key={getId(item)}
      item={item}
      props={props}
      columns={shown}
      sortable={sortable}
      dragDisabled={(reorder?.disabled ?? true) || savingOrder}
      onRequestDelete={() => setDeleting({ item, pending: false })}
    />
  ))

  return (
    <>
      <table aria-label={label} className={table}>
        <thead>
          <tr>
            {sortable && (
              <th className={headCell}>
                <span className={css({ srOnly: true })}>並べ替え</span>
              </th>
            )}
            {shown.map((column) => (
              <th key={column.key} className={headCell}>
                {column.header}
              </th>
            ))}
            <th className={headCell}>
              <span className={css({ srOnly: true })}>操作</span>
            </th>
          </tr>
        </thead>
        {sortable ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            accessibility={{
              announcements,
              screenReaderInstructions: {
                draggable: SORT_INSTRUCTIONS,
              },
            }}
          >
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <tbody>{rows}</tbody>
            </SortableContext>
          </DndContext>
        ) : (
          <tbody>{rows}</tbody>
        )}
      </table>
      {deleting && (
        <ConfirmDialog
          open
          title="削除の確認"
          message={props.deleteMessage?.(deleting.item) ?? `『${getTitle(deleting.item)}』を削除します。元に戻せません`}
          confirmLabel="削除する"
          danger
          pending={deleting.pending}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  )
}

interface ListRowProps<T> {
  item: T
  props: AdminListProps<T>
  columns: Column<T>[]
  sortable: boolean
  dragDisabled: boolean
  onRequestDelete: () => void
}

function ListRow<T>(rowProps: ListRowProps<T>) {
  return rowProps.sortable ? <SortableListRow {...rowProps} /> : <PlainListRow {...rowProps} />
}

function PlainListRow<T>(rowProps: ListRowProps<T>) {
  const router = useRouter()
  const href = rowProps.props.editHref(rowProps.item)
  return (
    <tr
      className={row}
      onClick={(event) => {
        if (!fromControl(event)) void router.navigate({ href })
      }}
    >
      <RowCells {...rowProps} handle={null} />
    </tr>
  )
}

function SortableListRow<T>(rowProps: ListRowProps<T>) {
  const router = useRouter()
  const { props, item, dragDisabled } = rowProps
  const href = props.editHref(item)
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: props.getId(item),
    disabled: dragDisabled,
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
      disabled={dragDisabled}
      aria-label={`「${props.getTitle(item)}」を並べ替える`}
      className={cx(iconButton, css({ cursor: 'grab', touchAction: 'none' }))}
    >
      <GripIcon size="sm" />
    </button>
  )
  return (
    <tr
      ref={setNodeRef}
      style={style}
      data-dragging={isDragging}
      className={cx(row, sortableRow)}
      onClick={(event) => {
        if (!fromControl(event)) void router.navigate({ href })
      }}
    >
      <RowCells {...rowProps} handle={handle} />
    </tr>
  )
}

function RowCells<T>({
  item,
  props,
  columns,
  sortable,
  onRequestDelete,
  handle,
}: ListRowProps<T> & { handle: ReactNode }) {
  const publicHref = props.publicHref?.(item) ?? null
  const title = props.getTitle(item)
  return (
    <>
      {sortable && <td className={cx(cell, css({ w: 'control' }))}>{handle}</td>}
      {columns.map((column) => (
        <td key={column.key} className={cell}>
          {column.primary ? (
            <AdminLink href={props.editHref(item)} className={primaryLink}>
              {column.cell(item)}
            </AdminLink>
          ) : (
            column.cell(item)
          )}
        </td>
      ))}
      <td className={cx(cell, css({ w: 'control', textAlign: 'end' }))}>
        <Menu
          trigger={<MoreIcon size="sm" />}
          triggerClassName={iconButton}
          triggerLabel={`「${title}」の操作`}
          items={[
            ...(publicHref === null
              ? []
              : [{ value: 'view', label: '公開サイトで見る', href: publicHref, external: true }]),
            { value: 'delete', label: '削除' },
          ]}
          onSelect={(value) => {
            if (value === 'delete') onRequestDelete()
          }}
        />
      </td>
    </>
  )
}

/**
 * A7 使用技術管理（design-spec 6.6・6.7、SDD 5.8）。一覧は L4（並べ替え）、編集は L6。下書き・公開は持たない
 */
import { ORPCError } from '@orpc/client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { css, cx } from 'styled-system/css'
import { z } from 'zod'
import { LIMITS } from '~/api/contract/common'
import { type stackOutput, stackUpdateInput } from '~/api/contract/stacks'
import { PlusIcon } from '~/ui/icons'
import { FallbackImage, InitialBadge } from '~/ui/image'
import { button } from '~/ui/recipes'
import { toaster } from '~/ui/toast'
import { api } from './api'
import { ConfirmDialog } from './confirm-dialog'
import {
  BackLink,
  checkWithSchema,
  EditLoadError,
  EditLoading,
  EditNotFound,
  RestoreBanner,
  SaveActions,
  SaveProblems,
  SaveStatus,
  useEditor,
  useEditorKey,
  useSaveShortcut,
} from './editor'
import { isAuthError, isNotFoundError } from './errors'
import { ImageField, SwitchField, TextField } from './fields'
import { listLabel, NOTICES, newItemTitle, SECTION_LABELS } from './labels'
import { FormLayout, ListLayout } from './layouts'
import { AdminLink } from './link'
import { AdminList } from './list-view'

/** 使用技術を使う種類（プロジェクト・作品）。画面に出す名前は公開サイトのセクションの名前（design-spec 1.4） */
const USED_IN = `${SECTION_LABELS.projects}・${SECTION_LABELS.works}`

type Stack = z.infer<typeof stackOutput>
type StackListOutput = Awaited<ReturnType<typeof api.stacks.list>>

const LIST_HREF = '/admin/stacks'
const LIST_KEY = ['stacks', 'list']

/** 削除の確認（design-spec 6.7.2: 使っている作品・プロジェクトの数を出す） */
function deleteMessage(stack: { displayName: string; usageCount: number }): string {
  const usage = stack.usageCount > 0 ? `使っている ${USED_IN} ${stack.usageCount}件の紐づけも外れます。` : ''
  return `『${stack.displayName}』を削除します。${usage}元に戻せません`
}

function StackIconCell({ name, url }: { name: string; url: string | null }) {
  const fallback = <InitialBadge name={name} size="icon" />
  if (url === null) return fallback
  return (
    <FallbackImage
      src={url}
      alt={name}
      className={css({ w: 'icon', h: 'icon', objectFit: 'contain' })}
      fallback={fallback}
    />
  )
}

// ---- 一覧 ------------------------------------------------------------------

export function StacksListPage() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: LIST_KEY, queryFn: () => api.stacks.list() })

  return (
    <ListLayout
      title={SECTION_LABELS.stack}
      actions={
        <AdminLink href={`${LIST_HREF}/new`} className={cx(button(), css({ textDecoration: 'none' }))}>
          <PlusIcon size="sm" />
          新規作成
        </AdminLink>
      }
    >
      <AdminList
        label={listLabel(SECTION_LABELS.stack)}
        query={{ status: query.status, data: query.data?.items, refetch: query.refetch }}
        columns={[
          {
            key: 'icon',
            header: 'アイコン',
            cell: (item) => <StackIconCell name={item.displayName} url={item.iconUrl} />,
          },
          { key: 'displayName', header: '表示名', primary: true, mobile: true, cell: (item) => item.displayName },
          { key: 'showOnTop', header: 'トップに表示', cell: (item) => (item.showOnTop ? '表示する' : '表示しない') },
          { key: 'usageCount', header: `使っている ${USED_IN}`, cell: (item) => `${item.usageCount}件` },
        ]}
        getId={(item) => item.id}
        getTitle={(item) => item.displayName}
        editHref={(item) => `${LIST_HREF}/${item.id}`}
        deleteMessage={deleteMessage}
        onDelete={async (item) => {
          await api.stacks.remove({ params: { id: item.id } })
          await queryClient.invalidateQueries({ queryKey: ['stacks'] })
          void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
        }}
        reorder={{
          disabled: false,
          save: async (ids) => {
            try {
              await api.stacks.reorder({ ids })
            } catch (error) {
              // 別のタブで追加・削除されて集合が違う（SDD 5.7）。今の一覧を読み直してから失敗を伝える
              if (error instanceof ORPCError && error.code === 'ORDER_OUT_OF_DATE') {
                await queryClient.invalidateQueries({ queryKey: LIST_KEY })
              }
              throw error
            }
            queryClient.setQueryData<StackListOutput>(LIST_KEY, (current) => {
              if (current === undefined) return current
              const byId = new Map(current.items.map((item) => [item.id, item]))
              return {
                items: ids.flatMap((id, index) => {
                  const item = byId.get(id)
                  return item === undefined ? [] : [{ ...item, sortOrder: index }]
                }),
              }
            })
          },
        }}
        filtered={false}
        newHref={`${LIST_HREF}/new`}
      />
    </ListLayout>
  )
}

// ---- 編集 ------------------------------------------------------------------

const stackFormSchema = z.object({
  key: z.string(),
  displayName: z.string(),
  iconUrl: z.string(),
  linkUrl: z.string(),
  showOnTop: z.boolean(),
})
type StackForm = z.infer<typeof stackFormSchema>

const parseStackForm = (value: unknown): StackForm | null => stackFormSchema.safeParse(value).data ?? null

/** 欄のキーの並び（画面の上から。誤りの欄へ移るときの順） */
const FIELD_ORDER = ['displayName', 'key', 'iconUrl', 'linkUrl', 'showOnTop']

function toForm(stack: Stack | null): StackForm {
  if (stack === null) return { key: '', displayName: '', iconUrl: '', linkUrl: '', showOnTop: true }
  return {
    key: stack.key,
    displayName: stack.displayName,
    iconUrl: stack.iconUrl ?? '',
    linkUrl: stack.linkUrl ?? '',
    showOnTop: stack.showOnTop,
  }
}

export function StackEditPage({ id }: { id: string }) {
  const isNew = id === 'new'
  const query = useQuery({
    queryKey: ['stacks', 'item', id],
    queryFn: () => api.stacks.get({ params: { id } }),
    enabled: !isNew,
  })
  const editor = useEditorKey(id)
  const back = <BackLink href={LIST_HREF}>{SECTION_LABELS.stack}</BackLink>
  const disabledActions = <SaveActions pending={null} disabled onSave={() => {}} />

  if (!isNew && query.status === 'pending') {
    return (
      <FormLayout back={back} title={SECTION_LABELS.stack} actions={disabledActions}>
        <EditLoading />
      </FormLayout>
    )
  }
  if (!isNew && query.status === 'error') {
    return (
      <FormLayout back={back} title={SECTION_LABELS.stack} actions={disabledActions}>
        {isNotFoundError(query.error) ? (
          <EditNotFound listHref={LIST_HREF} />
        ) : (
          <EditLoadError onRetry={() => query.refetch()} />
        )}
      </FormLayout>
    )
  }
  return <StackEditor key={editor.key} onCreated={editor.markCreated} initial={isNew ? null : (query.data ?? null)} />
}

function StackEditor({ initial, onCreated }: { initial: Stack | null; onCreated: (id: string) => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const editor = useEditor({
    initial,
    toForm,
    backupType: 'stack',
    parseValues: parseStackForm,
    idOf: (item) => item.id,
    updatedAtOf: (item) => item.updatedAt,
    saveKind: 'plain',
    fieldOrder: FIELD_ORDER,
  })
  const { form, values, saved, save, session } = editor

  function submit() {
    const sent = form.state.values
    const body = sent
    return save.run('save', {
      // 識別名は A7 では必須（design-spec 6.7.3）。作成の API は省けるが、それは A5・A6 の「新しい技術として追加」のため
      check: () => checkWithSchema(stackUpdateInput, body),
      request: () => (saved === null ? api.stacks.create(body) : api.stacks.update({ params: { id: saved.id }, body })),
      onSuccess: async (output) => {
        const created = editor.applySaved(output, sent)
        queryClient.setQueryData(['stacks', 'item', output.id], output)
        void queryClient.invalidateQueries({ queryKey: LIST_KEY })
        void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
        if (created) {
          onCreated(output.id)
          await session.leave(() => navigate({ to: '/admin/stacks/$id', params: { id: output.id }, replace: true }))
        }
      },
    })
  }

  async function remove() {
    if (saved === null) return
    save.setPending('delete')
    try {
      await api.stacks.remove({ params: { id: saved.id } })
      session.clear()
      // 消した項目を読み直すと NOT_FOUND になり、一覧へ移る前に「見つかりませんでした」が出うるので、読み直さずに捨てる
      queryClient.removeQueries({ queryKey: ['stacks', 'item', saved.id] })
      void queryClient.invalidateQueries({ queryKey: LIST_KEY })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      await session.leave(() => navigate({ to: '/admin/stacks' }))
      toaster.create({ title: NOTICES.deleted, type: 'success' })
    } catch (error) {
      if (!isAuthError(error)) toaster.create({ title: NOTICES.deleteFailed, type: 'error' })
      save.setPending(null)
      setConfirmDelete(false)
    }
  }

  useSaveShortcut(
    () => editor.shortcut(confirmDelete),
    () => void submit(),
  )

  const title = saved === null ? newItemTitle(SECTION_LABELS.stack) : saved.displayName

  return (
    <editor.BusyProvider>
      <FormLayout
        back={<BackLink href={LIST_HREF}>{SECTION_LABELS.stack}</BackLink>}
        title={title}
        status={<SaveStatus {...editor.saveStatus} />}
        actions={
          <SaveActions
            pending={save.pending}
            reason={editor.reason}
            onSave={() => void submit()}
            onDelete={saved === null ? undefined : () => setConfirmDelete(true)}
          />
        }
      >
        {session.offer !== null && (
          <RestoreBanner offer={session.offer} onRestore={session.restoreOffer} onDiscard={session.discardOffer} />
        )}
        <SaveProblems missing={save.missing} formErrors={save.formErrors} fieldLabels={{}} />
        <form.Field name="displayName">
          {(field) => (
            <TextField
              label="表示名"
              limit={LIMITS.shortText}
              name={field.name}
              value={field.state.value}
              onChange={field.handleChange}
              {...save.fieldState(field.name)}
            />
          )}
        </form.Field>
        <form.Field name="key">
          {(field) => (
            <TextField
              label="識別名"
              hint="半角の英小文字・数字・ハイフン"
              name={field.name}
              value={field.state.value}
              onChange={field.handleChange}
              {...save.fieldState(field.name)}
            />
          )}
        </form.Field>
        <form.Field name="iconUrl">
          {(field) => (
            <ImageField
              label="アイコン画像"
              name={field.name}
              value={field.state.value}
              onChange={field.handleChange}
              alt={values.displayName}
              {...save.fieldState(field.name)}
            />
          )}
        </form.Field>
        <form.Field name="linkUrl">
          {(field) => (
            <TextField
              label="リンク"
              type="url"
              placeholder="https://"
              name={field.name}
              value={field.state.value}
              onChange={field.handleChange}
              {...save.fieldState(field.name)}
            />
          )}
        </form.Field>
        <form.Field name="showOnTop">
          {(field) => (
            <SwitchField
              label="トップに表示する"
              name={field.name}
              checked={field.state.value}
              onChange={field.handleChange}
            />
          )}
        </form.Field>
        <ConfirmDialog
          open={confirmDelete}
          title="削除の確認"
          message={saved === null ? '' : deleteMessage(saved)}
          confirmLabel="削除する"
          danger
          pending={save.pending === 'delete'}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        />
        {session.leaveDialog}
      </FormLayout>
    </editor.BusyProvider>
  )
}

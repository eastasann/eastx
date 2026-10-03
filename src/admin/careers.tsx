/**
 * A4 経歴管理（design-spec 6.6・6.7、SDD 5.6）。一覧は L4、編集は L6
 */
import { useForm, useStore } from '@tanstack/react-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { css, cx } from 'styled-system/css'
import { z } from 'zod'
import { careerInput, type careerOutput } from '~/api/contract/careers'
import { CAREER_KINDS } from '~/db/schema'
import { languagesOf } from '~/domain/languages'
import type { Status, Transition } from '~/domain/publishing'
import type { Lang } from '~/i18n/detect'
import { formatAdminDate, formatAdminYearMonth } from '~/i18n/format'
import { PlusIcon } from '~/ui/icons'
import { button, label } from '~/ui/recipes'
import { Select } from '~/ui/select'
import { toaster } from '~/ui/toast'
import { api } from './api'
import { backupKey } from './backup'
import { ConfirmDialog } from './confirm-dialog'
import {
  BackLink,
  checkWithSchema,
  EditLoadError,
  EditLoading,
  EditNotFound,
  LanguageTabs,
  PublishActions,
  RestoreBanner,
  SaveProblems,
  useEditorKey,
  useEditSession,
  useSaveState,
} from './editor'
import { isAuthError, isNotFoundError } from './errors'
import { MarkdownField, SelectField, TextField } from './fields'
import { rebaseValues } from './form-values'
import { CAREER_KIND_LABELS, displayTitle, languagesLabel, NOTICES, STATUS_LABELS } from './labels'
import { FormLayout, ListLayout } from './layouts'
import { AdminLink } from './link'
import { AdminList } from './list-view'
import { ALL } from './search'

type CareerKind = (typeof CAREER_KINDS)[number]
type Career = z.infer<typeof careerOutput>

const LIST_HREF = '/admin/careers'

export interface CareersSearch {
  status?: Status
  kind?: CareerKind
}

// ---- 一覧 ------------------------------------------------------------------

function periodLabel(start: string | null, end: string | null): string {
  if (start === null) return '—'
  return `${formatAdminYearMonth(start)} – ${end === null ? '現在' : formatAdminYearMonth(end)}`
}

export function CareersListPage({ search }: { search: CareersSearch }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['careers', 'list', search],
    queryFn: () => api.careers.list({ status: search.status, kind: search.kind }),
  })
  const setSearch = (next: CareersSearch) => navigate({ to: '/admin/careers', search: next, replace: true })

  return (
    <ListLayout
      title="経歴"
      actions={
        <>
          <Select
            label="状態"
            options={[
              { value: ALL, label: 'すべて' },
              { value: 'draft', label: STATUS_LABELS.draft },
              { value: 'published', label: STATUS_LABELS.published },
            ]}
            value={search.status ?? ALL}
            onValueChange={(value) =>
              setSearch({ ...search, status: value === 'draft' || value === 'published' ? value : undefined })
            }
          />
          <Select
            label="種類"
            options={[
              { value: ALL, label: 'すべて' },
              ...CAREER_KINDS.map((kind) => ({ value: kind, label: CAREER_KIND_LABELS[kind] })),
            ]}
            value={search.kind ?? ALL}
            onValueChange={(value) => setSearch({ ...search, kind: CAREER_KINDS.find((kind) => kind === value) })}
          />
          <AdminLink
            href={`${LIST_HREF}/new`}
            className={cx(button(), css({ textDecoration: 'none', alignSelf: 'flex-end' }))}
          >
            <PlusIcon size="sm" />
            新規作成
          </AdminLink>
        </>
      }
    >
      <AdminList
        label="経歴の一覧"
        query={{ status: query.status, data: query.data?.items, refetch: query.refetch }}
        columns={[
          { key: 'kind', header: '種類', cell: (item) => CAREER_KIND_LABELS[item.kind] },
          {
            key: 'title',
            header: 'タイトル',
            primary: true,
            mobile: true,
            cell: (item) => displayTitle({ ja: item.ja.title, en: item.en.title }),
          },
          {
            key: 'organization',
            header: '所属',
            cell: (item) => displayTitle({ ja: item.ja.organization, en: item.en.organization }) || '—',
          },
          { key: 'period', header: '期間', cell: (item) => periodLabel(item.startDate, item.endDate) },
          {
            key: 'status',
            header: '状態',
            mobile: true,
            cell: (item) => (
              <span className={label({ tone: item.status === 'published' ? 'accent' : 'neutral' })}>
                {STATUS_LABELS[item.status]}
              </span>
            ),
          },
          { key: 'languages', header: '言語', cell: (item) => languagesLabel(item.languages) },
          { key: 'updatedAt', header: '最終保存日', cell: (item) => formatAdminDate(item.updatedAt) },
        ]}
        getId={(item) => item.id}
        getTitle={(item) => displayTitle({ ja: item.ja.title, en: item.en.title })}
        editHref={(item) => `${LIST_HREF}/${item.id}`}
        // 経歴は詳細ページを持たないので、トップの経歴のセクション（日本語版。design-spec 6.6）
        publicHref={(item) => (item.status === 'published' ? '/ja#career' : null)}
        onDelete={async (item) => {
          await api.careers.remove({ params: { id: item.id } })
          await queryClient.invalidateQueries({ queryKey: ['careers'] })
          void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
        }}
        filtered={search.status !== undefined || search.kind !== undefined}
        onClearFilter={() => setSearch({})}
        newHref={`${LIST_HREF}/new`}
      />
    </ListLayout>
  )
}

// ---- 編集 ------------------------------------------------------------------

const localizedForm = z.object({ title: z.string(), organization: z.string(), location: z.string(), body: z.string() })
const careerFormSchema = z.object({
  kind: z.enum(CAREER_KINDS),
  startDate: z.string(),
  endDate: z.string(),
  ja: localizedForm,
  en: localizedForm,
})
type CareerForm = z.infer<typeof careerFormSchema>

const isCareerForm = (value: unknown): value is CareerForm => careerFormSchema.safeParse(value).success

const emptyLocalized = { title: '', organization: '', location: '', body: '' }

function toForm(career: Career | null): CareerForm {
  if (career === null) return { kind: 'work', startDate: '', endDate: '', ja: emptyLocalized, en: emptyLocalized }
  const localized = (lang: Lang) => ({
    title: career[lang].title ?? '',
    organization: career[lang].organization ?? '',
    location: career[lang].location ?? '',
    body: career[lang].body ?? '',
  })
  return {
    kind: career.kind,
    startDate: career.startDate ?? '',
    endDate: career.endDate ?? '',
    ja: localized('ja'),
    en: localized('en'),
  }
}

const FIELD_LABELS = { title: 'タイトル', startDate: '開始年月' }

export function CareerEditPage({ id }: { id: string }) {
  const isNew = id === 'new'
  const query = useQuery({
    queryKey: ['careers', 'item', id],
    queryFn: () => api.careers.get({ params: { id } }),
    enabled: !isNew,
  })
  const editor = useEditorKey(id)
  const back = <BackLink href={LIST_HREF}>経歴一覧</BackLink>
  const disabledActions = (
    <PublishActions status={null} pending={null} disabled hideStatus onSave={() => {}} onUnpublish={() => {}} />
  )

  if (!isNew && query.status === 'pending') {
    return (
      <FormLayout back={back} title="経歴">
        <EditLoading actions={disabledActions} />
      </FormLayout>
    )
  }
  if (!isNew && query.status === 'error') {
    return (
      <FormLayout back={back} title="経歴">
        {isNotFoundError(query.error) ? (
          <EditNotFound listHref={LIST_HREF} />
        ) : (
          <EditLoadError onRetry={() => query.refetch()} actions={disabledActions} />
        )}
      </FormLayout>
    )
  }
  return <CareerEditor key={editor.key} onCreated={editor.markCreated} initial={isNew ? null : (query.data ?? null)} />
}

function CareerEditor({ initial, onCreated }: { initial: Career | null; onCreated: (id: string) => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [saved, setSaved] = useState(initial)
  const [baseline, setBaseline] = useState(() => toForm(initial))
  const [confirm, setConfirm] = useState<'unpublish' | 'delete' | null>(null)
  // useForm の既定値は、最後に reset に渡した値と同じに保つ。違うと、TanStack Form は描画のたびに既定値が
  // 変わったとみなし、触っていないフォームの値を既定値で上書きする（保存を待つあいだの入力が消える）
  const [formDefaults, setFormDefaults] = useState(baseline)
  const form = useForm({ defaultValues: formDefaults })
  const values = useStore(form.store, (state) => state.values)
  const save = useSaveState()
  const session = useEditSession({
    getValues: () => form.state.values,
    baseline,
    backupKey: backupKey('career', saved?.id ?? null),
    isValues: isCareerForm,
    restore: (restored) => form.reset(restored, { keepDefaultValues: true }),
  })

  function submit(action: Transition) {
    const sent = form.state.values
    const status: Status = action === 'publish' || action === 'update' ? 'published' : 'draft'
    const body = { ...form.state.values, status }
    return save.run(action, {
      check: () => checkWithSchema(careerInput, body),
      request: () =>
        saved === null ? api.careers.create(body) : api.careers.update({ params: { id: saved.id }, body }),
      onSuccess: async (output) => {
        const next = toForm(output)
        setSaved(output)
        setBaseline(next)
        const merged = rebaseValues(sent, form.state.values, next)
        setFormDefaults(merged)
        form.reset(merged)
        session.clearBackup()
        queryClient.setQueryData(['careers', 'item', output.id], output)
        void queryClient.invalidateQueries({ queryKey: ['careers', 'list'] })
        void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
        // 新規作成で初めて保存したら、URL を作成した項目のものに置き換える（SDD 4.1）
        if (saved === null) {
          onCreated(output.id)
          await session.leave(() => navigate({ to: '/admin/careers/$id', params: { id: output.id }, replace: true }))
        }
      },
    })
  }

  async function remove() {
    if (saved === null) return
    save.setPending('delete')
    try {
      await api.careers.remove({ params: { id: saved.id } })
      session.clearBackup()
      // 消した項目を読み直すと NOT_FOUND になり、一覧へ移る前に「見つかりませんでした」が出うるので、読み直さずに捨てる
      queryClient.removeQueries({ queryKey: ['careers', 'item', saved.id] })
      void queryClient.invalidateQueries({ queryKey: ['careers', 'list'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      await session.leave(() => navigate({ to: '/admin/careers' }))
      toaster.create({ title: NOTICES.deleted, type: 'success' })
    } catch (error) {
      if (!isAuthError(error)) toaster.create({ title: NOTICES.deleteFailed, type: 'error' })
      save.setPending(null)
      setConfirm(null)
    }
  }

  const title = saved === null ? '経歴の新規作成' : displayTitle({ ja: saved.ja.title, en: saved.en.title })
  const languages = languagesOf('title', values.ja, values.en)
  const panel = (lang: Lang) => (
    <>
      <form.Field name={`${lang}.title`}>
        {(field) => (
          <TextField
            label="タイトル"
            name={field.name}
            value={field.state.value}
            onChange={field.handleChange}
            lang={lang}
            {...save.fieldState(field.name)}
          />
        )}
      </form.Field>
      <form.Field name={`${lang}.organization`}>
        {(field) => (
          <TextField
            label="所属"
            name={field.name}
            value={field.state.value}
            onChange={field.handleChange}
            lang={lang}
            {...save.fieldState(field.name)}
          />
        )}
      </form.Field>
      <form.Field name={`${lang}.location`}>
        {(field) => (
          <TextField
            label="場所"
            name={field.name}
            value={field.state.value}
            onChange={field.handleChange}
            lang={lang}
            {...save.fieldState(field.name)}
          />
        )}
      </form.Field>
      <form.Field name={`${lang}.body`}>
        {(field) => (
          <MarkdownField
            label="内容"
            name={field.name}
            value={field.state.value}
            onChange={field.handleChange}
            lang={lang}
            {...save.fieldState(field.name)}
          />
        )}
      </form.Field>
    </>
  )

  return (
    <FormLayout
      back={<BackLink href={LIST_HREF}>経歴一覧</BackLink>}
      title={title}
      actions={
        <PublishActions
          status={saved?.status ?? null}
          pending={save.pending}
          onSave={(action) => void submit(action)}
          onUnpublish={() => setConfirm('unpublish')}
          onDelete={() => setConfirm('delete')}
        />
      }
    >
      {session.offer !== null && <RestoreBanner onRestore={session.restoreOffer} onDiscard={session.discardOffer} />}
      <SaveProblems missing={save.missing} formErrors={save.formErrors} fieldLabels={FIELD_LABELS} />
      <form.Field name="kind">
        {(field) => (
          <SelectField
            label="種類"
            name={field.name}
            options={CAREER_KINDS.map((kind) => ({ value: kind, label: CAREER_KIND_LABELS[kind] }))}
            value={field.state.value}
            onChange={(value) => {
              const kind = CAREER_KINDS.find((candidate) => candidate === value)
              if (kind) field.handleChange(kind)
            }}
            {...save.fieldState(field.name)}
          />
        )}
      </form.Field>
      <div className={css({ display: 'flex', flexWrap: 'wrap', gap: 'stack-dense' })}>
        <form.Field name="startDate">
          {(field) => (
            <TextField
              label="開始年月"
              type="month"
              name={field.name}
              value={field.state.value}
              onChange={field.handleChange}
              {...save.fieldState(field.name)}
            />
          )}
        </form.Field>
        <form.Field name="endDate">
          {(field) => (
            <TextField
              label="終了年月"
              type="month"
              hint="空なら「現在」"
              name={field.name}
              value={field.state.value}
              onChange={field.handleChange}
              {...save.fieldState(field.name)}
            />
          )}
        </form.Field>
      </div>
      <LanguageTabs
        languages={languages}
        problems={{ ja: save.hasProblemIn('ja'), en: save.hasProblemIn('en') }}
        panels={{ ja: panel('ja'), en: panel('en') }}
      />
      <ConfirmDialog
        open={confirm === 'unpublish'}
        title="非公開に戻す"
        message="公開サイトから見えなくなります"
        confirmLabel="非公開に戻す"
        pending={save.pending === 'unpublish'}
        onConfirm={async () => {
          await submit('unpublish')
          setConfirm(null)
        }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title="削除の確認"
        message={`『${title}』を削除します。元に戻せません`}
        confirmLabel="削除する"
        danger
        pending={save.pending === 'delete'}
        onConfirm={() => void remove()}
        onCancel={() => setConfirm(null)}
      />
      {session.leaveDialog}
    </FormLayout>
  )
}

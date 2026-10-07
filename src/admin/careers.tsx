/**
 * A4 経歴管理（design-spec 6.6・6.7、SDD 5.6）。一覧は L4、編集は L6
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { css, cx } from 'styled-system/css'
import { z } from 'zod'
import { careerInput, type careerOutput } from '~/api/contract/careers'
import { LIMITS } from '~/api/contract/common'
import { CAREER_KINDS } from '~/db/enums'
import { languagesOf } from '~/domain/languages'
import type { Status, Transition } from '~/domain/publishing'
import type { Lang } from '~/i18n/detect'
import { formatAdminDate, formatAdminYearMonth } from '~/i18n/format'
import { PlusIcon } from '~/ui/icons'
import { button } from '~/ui/recipes'
import { Select } from '~/ui/select'
import { toaster } from '~/ui/toast'
import { api } from './api'
import {
  BackLink,
  checkWithSchema,
  EditLoadError,
  EditLoading,
  EditNotFound,
  LocalizedFields,
  PublishActions,
  RestoreBanner,
  SaveProblems,
  SaveStatus,
  StatusBadge,
  useEditor,
  useEditorKey,
  useLocalizedView,
  usePublishFlow,
} from './editor'
import { isAuthError, isNotFoundError } from './errors'
import { MarkdownField, SelectField, TextField } from './fields'
import {
  CAREER_KIND_LABELS,
  displayTitle,
  languagesLabel,
  listLabel,
  NOTICES,
  newItemTitle,
  SECTION_LABELS,
  STATUS_LABELS,
} from './labels'
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
      title={SECTION_LABELS.career}
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
        label={listLabel(SECTION_LABELS.career)}
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
            cell: (item) => <StatusBadge status={item.status} />,
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

/** 欄のキーの並び（画面の上から。誤りの欄へ移るときの順） */
const FIELD_ORDER = [
  'kind',
  'startDate',
  'endDate',
  ...(['ja', 'en'] as const).flatMap((lang) =>
    ['title', 'organization', 'location', 'body'].map((name) => `${lang}.${name}`),
  ),
]

function disabledActions() {
  return <PublishActions status={null} pending={null} disabled onSave={() => {}} onUnpublish={() => {}} />
}

export function CareerEditPage({ id }: { id: string }) {
  const isNew = id === 'new'
  const query = useQuery({
    queryKey: ['careers', 'item', id],
    queryFn: () => api.careers.get({ params: { id } }),
    enabled: !isNew,
  })
  const editor = useEditorKey(id)
  const back = <BackLink href={LIST_HREF}>{SECTION_LABELS.career}</BackLink>

  if (!isNew && query.status === 'pending') {
    return (
      <FormLayout back={back} title={SECTION_LABELS.career} actions={disabledActions()}>
        <EditLoading />
      </FormLayout>
    )
  }
  if (!isNew && query.status === 'error') {
    return (
      <FormLayout back={back} title={SECTION_LABELS.career} actions={disabledActions()}>
        {isNotFoundError(query.error) ? (
          <EditNotFound listHref={LIST_HREF} />
        ) : (
          <EditLoadError onRetry={() => query.refetch()} />
        )}
      </FormLayout>
    )
  }
  return <CareerEditor key={editor.key} onCreated={editor.markCreated} initial={isNew ? null : (query.data ?? null)} />
}

function CareerEditor({ initial, onCreated }: { initial: Career | null; onCreated: (id: string) => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const localizedView = useLocalizedView()
  const editor = useEditor({
    initial,
    toForm,
    backupType: 'career',
    isValues: isCareerForm,
    idOf: (item) => item.id,
    updatedAtOf: (item) => item.updatedAt,
    saveKind: 'publishable',
    statusOf: (item) => item.status,
    fieldOrder: FIELD_ORDER,
    reveal: localizedView.reveal,
  })
  const { form, values, saved, save, session } = editor

  function submit(action: Transition) {
    const sent = form.state.values
    const status: Status = action === 'publish' || action === 'update' ? 'published' : 'draft'
    const body = { ...sent, status }
    return save.run(action, {
      check: () => checkWithSchema(careerInput, body),
      request: () =>
        saved === null ? api.careers.create(body) : api.careers.update({ params: { id: saved.id }, body }),
      onSuccess: async (output) => {
        const created = editor.applySaved(output, sent)
        queryClient.setQueryData(['careers', 'item', output.id], output)
        void queryClient.invalidateQueries({ queryKey: ['careers', 'list'] })
        void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
        // 新規作成で初めて保存したら、URL を作成した項目のものに置き換える（SDD 4.1）
        if (created) {
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
      session.clear()
      // 消した項目を読み直すと NOT_FOUND になり、一覧へ移る前に「見つかりませんでした」が出うるので、読み直さずに捨てる
      queryClient.removeQueries({ queryKey: ['careers', 'item', saved.id] })
      void queryClient.invalidateQueries({ queryKey: ['careers', 'list'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      await session.leave(() => navigate({ to: '/admin/careers' }))
      toaster.create({ title: NOTICES.deleted, type: 'success' })
    } catch (error) {
      if (!isAuthError(error)) toaster.create({ title: NOTICES.deleteFailed, type: 'error' })
      save.setPending(null)
      flow.closeConfirm()
    }
  }

  const title =
    saved === null ? newItemTitle(SECTION_LABELS.career) : displayTitle({ ja: saved.ja.title, en: saved.en.title })
  const flow = usePublishFlow({
    title,
    pending: save.pending,
    // 経歴はスラッグを持たない
    slugChanged: () => false,
    submit,
    remove,
    shortcut: editor.shortcut,
  })
  const languages = languagesOf('title', values.ja, values.en)
  const localized = (lang: Lang) => (
    <>
      <form.Field name={`${lang}.title`}>
        {(field) => (
          <TextField
            label="タイトル"
            limit={LIMITS.shortText}
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
            limit={LIMITS.shortText}
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
            limit={LIMITS.shortText}
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
    <editor.BusyProvider>
      <FormLayout
        back={<BackLink href={LIST_HREF}>{SECTION_LABELS.career}</BackLink>}
        title={title}
        status={
          <>
            <StatusBadge status={editor.status} />
            <SaveStatus {...editor.saveStatus} />
          </>
        }
        formView={{ value: localizedView.view, onChange: localizedView.setView }}
        actions={
          <PublishActions
            status={editor.status}
            pending={save.pending}
            reason={editor.reason}
            onSave={flow.requestSave}
            onUnpublish={flow.openUnpublish}
            onDelete={flow.openDelete}
          />
        }
      >
        {session.offer !== null && (
          <RestoreBanner offer={session.offer} onRestore={session.restoreOffer} onDiscard={session.discardOffer} />
        )}
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
        <LocalizedFields
          state={localizedView}
          languages={languages}
          problems={{ ja: save.hasProblemIn('ja'), en: save.hasProblemIn('en') }}
          render={localized}
        />
        {flow.dialogs}
        {session.leaveDialog}
      </FormLayout>
    </editor.BusyProvider>
  )
}

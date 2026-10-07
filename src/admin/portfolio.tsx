/**
 * A5 作品管理・A6 プロジェクト管理（design-spec 6.6・6.7、SDD 5.7）。一覧は L4（並べ替え）、編集は L5。
 * 形の違いは、作品が GitHub を持ち、プロジェクトが開始年月・終了年月を持つことだけなので、1つの部品で両方を扱う
 */
import { ORPCError } from '@orpc/client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { css, cx } from 'styled-system/css'
import { z } from 'zod'
import { LIMITS } from '~/api/contract/common'
import { projectInput, type projectOutput, workInput, type workOutput } from '~/api/contract/portfolio'
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
  EditNotFound,
  PublishActions,
  RestoreBanner,
  SaveProblems,
  StatusBadge,
  useEditor,
  useEditorKey,
  usePublishFlow,
} from './editor'
import { isAuthError, isNotFoundError } from './errors'
import { ImageField, TextAreaField, TextField } from './fields'
import { displayTitle, languagesLabel, listLabel, NOTICES, newItemTitle, SECTION_LABELS, STATUS_LABELS } from './labels'
import { FormLayout, ListLayout, SplitEditSkeleton } from './layouts'
import { AdminLink } from './link'
import { AdminList } from './list-view'
import { LongFormEditView, SlugField, STACKS_LIST_KEY, StackPicker, slugChanged, useLongFormView } from './long-form'
import { ALL } from './search'

export type PortfolioKind = 'work' | 'project'

type Work = z.infer<typeof workOutput>
type Project = z.infer<typeof projectOutput>
type PortfolioItem = Work | Project

const KINDS = {
  work: {
    name: SECTION_LABELS.works,
    listHref: '/admin/works',
    queryKey: 'works',
    /** 公開サイトの詳細ページ（SDD 4.1）と、詳細ページを持たないときのトップのセクション（日本語版。design-spec 6.6） */
    publicPath: (slug: string) => `/ja/works/${slug}`,
    section: '/ja#works',
  },
  project: {
    name: SECTION_LABELS.projects,
    listHref: '/admin/projects',
    queryKey: 'projects',
    publicPath: (slug: string) => `/ja/projects/${slug}`,
    section: '/ja#projects',
  },
} as const

export interface PortfolioSearch {
  status?: Status
}

function periodLabel(start: string | null, end: string | null): string {
  if (start === null) return '—'
  return `${formatAdminYearMonth(start)} – ${end === null ? '現在' : formatAdminYearMonth(end)}`
}

// ---- 一覧 ------------------------------------------------------------------

interface PortfolioListItem {
  id: string
  slug: string | null
  status: Status
  ja: { title: string | null }
  en: { title: string | null }
  hasDetail: boolean
  languages: { ja: boolean; en: boolean }
  sortOrder: number
  updatedAt: string
  startDate?: string | null
  endDate?: string | null
}

function listItems(kind: PortfolioKind, status: Status | undefined): Promise<{ items: PortfolioListItem[] }> {
  return kind === 'work' ? api.works.list({ status }) : api.projects.list({ status })
}

export function PortfolioListPage({ kind, search }: { kind: PortfolioKind; search: PortfolioSearch }) {
  const config = KINDS[kind]
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const listKey = [config.queryKey, 'list', search]
  const query = useQuery({ queryKey: listKey, queryFn: () => listItems(kind, search.status) })
  const setSearch = (next: PortfolioSearch) => navigate({ to: config.listHref, search: next, replace: true })
  const titleOf = (item: PortfolioListItem) => displayTitle({ ja: item.ja.title, en: item.en.title })

  return (
    <ListLayout
      title={config.name}
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
              setSearch({ status: value === 'draft' || value === 'published' ? value : undefined })
            }
          />
          <AdminLink
            href={`${config.listHref}/new`}
            className={cx(button(), css({ textDecoration: 'none', alignSelf: 'flex-end' }))}
          >
            <PlusIcon size="sm" />
            新規作成
          </AdminLink>
        </>
      }
    >
      <AdminList
        label={listLabel(config.name)}
        query={{ status: query.status, data: query.data?.items, refetch: query.refetch }}
        columns={[
          { key: 'title', header: 'タイトル', primary: true, mobile: true, cell: titleOf },
          ...(kind === 'project'
            ? [
                {
                  key: 'period',
                  header: '期間',
                  cell: (item: PortfolioListItem) => periodLabel(item.startDate ?? null, item.endDate ?? null),
                },
              ]
            : []),
          { key: 'hasDetail', header: '詳細ページ', cell: (item) => (item.hasDetail ? 'あり' : 'なし') },
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
        getTitle={titleOf}
        editHref={(item) => `${config.listHref}/${item.id}`}
        publicHref={(item) => {
          if (item.status !== 'published') return null
          return item.hasDetail && item.slug !== null ? config.publicPath(item.slug) : config.section
        }}
        onDelete={async (item) => {
          if (kind === 'work') await api.works.remove({ params: { id: item.id } })
          else await api.projects.remove({ params: { id: item.id } })
          await queryClient.invalidateQueries({ queryKey: [config.queryKey] })
          void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
          void queryClient.invalidateQueries({ queryKey: STACKS_LIST_KEY })
        }}
        reorder={{
          // 状態で絞り込んでいるあいだは、並べ替えを無効にする（design-spec 6.6）
          disabled: search.status !== undefined,
          save: async (ids) => {
            try {
              if (kind === 'work') await api.works.reorder({ ids })
              else await api.projects.reorder({ ids })
            } catch (error) {
              // 別のタブで追加・削除されて集合が違う（SDD 5.7）。今の一覧を読み直してから失敗を伝える
              if (error instanceof ORPCError && error.code === 'ORDER_OUT_OF_DATE') {
                await queryClient.invalidateQueries({ queryKey: [config.queryKey, 'list'] })
              }
              throw error
            }
            queryClient.setQueryData<{ items: PortfolioListItem[] }>(listKey, (current) => {
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
        filtered={search.status !== undefined}
        onClearFilter={() => setSearch({})}
        newHref={`${config.listHref}/new`}
      />
    </ListLayout>
  )
}

// ---- 編集 ------------------------------------------------------------------

const localizedForm = z.object({ title: z.string(), summary: z.string(), body: z.string() })
const portfolioFormSchema = z.object({
  slug: z.string(),
  ja: localizedForm,
  en: localizedForm,
  linkUrl: z.string(),
  /** 作品だけ */
  githubUrl: z.string(),
  /** プロジェクトだけ */
  startDate: z.string(),
  endDate: z.string(),
  thumbnailUrl: z.string(),
  stacks: z.array(z.object({ id: z.string(), displayName: z.string() })),
})
type PortfolioForm = z.infer<typeof portfolioFormSchema>

const isPortfolioForm = (value: unknown): value is PortfolioForm => portfolioFormSchema.safeParse(value).success

const emptyLocalized = { title: '', summary: '', body: '' }

function toForm(item: PortfolioItem | null): PortfolioForm {
  if (item === null) {
    return {
      slug: '',
      ja: emptyLocalized,
      en: emptyLocalized,
      linkUrl: '',
      githubUrl: '',
      startDate: '',
      endDate: '',
      thumbnailUrl: '',
      stacks: [],
    }
  }
  const localized = (lang: Lang) => ({
    title: item[lang].title ?? '',
    summary: item[lang].summary ?? '',
    body: item[lang].body ?? '',
  })
  return {
    slug: item.slug ?? '',
    ja: localized('ja'),
    en: localized('en'),
    linkUrl: item.linkUrl ?? '',
    githubUrl: 'githubUrl' in item ? (item.githubUrl ?? '') : '',
    startDate: 'startDate' in item ? (item.startDate ?? '') : '',
    endDate: 'endDate' in item ? (item.endDate ?? '') : '',
    thumbnailUrl: item.thumbnailUrl ?? '',
    stacks: item.stacks.map((stack) => ({ id: stack.id, displayName: stack.displayName })),
  }
}

function getItem(kind: PortfolioKind, id: string): Promise<PortfolioItem> {
  return kind === 'work' ? api.works.get({ params: { id } }) : api.projects.get({ params: { id } })
}

const FIELD_LABELS = { title: 'タイトル', slug: 'スラッグ', startDate: '開始年月' }

/** 設定パネルの欄（design-spec 6.7 の「L5 の欄の置き場所」）。誤りがあれば「設定」ボタンに印を付け、移るときは引き出しを開く */
const SETTINGS_KEYS: Record<PortfolioKind, readonly string[]> = {
  work: ['slug', 'linkUrl', 'githubUrl', 'stackIds', 'thumbnailUrl'],
  project: ['slug', 'startDate', 'endDate', 'linkUrl', 'stackIds', 'thumbnailUrl'],
}

const LOCALIZED_KEYS = ['ja.title', 'ja.summary', 'en.title', 'en.summary', 'ja.body', 'en.body']

function disabledActions() {
  return <PublishActions status={null} pending={null} disabled onSave={() => {}} onUnpublish={() => {}} />
}

export function PortfolioEditPage({ kind, id }: { kind: PortfolioKind; id: string }) {
  const config = KINDS[kind]
  const isNew = id === 'new'
  const query = useQuery({
    queryKey: [config.queryKey, 'item', id],
    queryFn: () => getItem(kind, id),
    enabled: !isNew,
  })
  const editor = useEditorKey(id)
  const back = <BackLink href={config.listHref}>{config.name}</BackLink>

  if (!isNew && query.status === 'pending') {
    return <SplitEditSkeleton back={back} title={config.name} actions={disabledActions()} />
  }
  if (!isNew && query.status === 'error') {
    return (
      <FormLayout back={back} title={config.name} actions={disabledActions()}>
        {isNotFoundError(query.error) ? (
          <EditNotFound listHref={config.listHref} />
        ) : (
          <EditLoadError onRetry={() => query.refetch()} />
        )}
      </FormLayout>
    )
  }
  return (
    <PortfolioEditor
      key={editor.key}
      onCreated={editor.markCreated}
      kind={kind}
      initial={isNew ? null : (query.data ?? null)}
    />
  )
}

function PortfolioEditor({
  kind,
  initial,
  onCreated,
}: {
  kind: PortfolioKind
  initial: PortfolioItem | null
  onCreated: (id: string) => void
}) {
  const config = KINDS[kind]
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const layout = useLongFormView(SETTINGS_KEYS[kind])
  const editor = useEditor({
    initial,
    toForm,
    backupType: kind,
    isValues: isPortfolioForm,
    idOf: (item) => item.id,
    updatedAtOf: (item) => item.updatedAt,
    saveKind: 'publishable',
    statusOf: (item) => item.status,
    fieldOrder: [...LOCALIZED_KEYS, ...SETTINGS_KEYS[kind]],
    reveal: layout.reveal,
  })
  const { form, values, saved, save, session } = editor
  // 公開したことがあるか: 初めて公開した日時が記録されていること（design-spec 6.7.2）
  const everPublished = saved?.firstPublishedAt != null

  function submit(action: Transition) {
    const sent = form.state.values
    const status: Status = action === 'publish' || action === 'update' ? 'published' : 'draft'
    const { stacks, githubUrl, startDate, endDate, ...rest } = sent
    const common = { ...rest, status, stackIds: stacks.map((stack) => stack.id) }
    const onSuccess = async (output: PortfolioItem) => {
      const created = editor.applySaved(output, sent)
      queryClient.setQueryData([config.queryKey, 'item', output.id], output)
      void queryClient.invalidateQueries({ queryKey: [config.queryKey, 'list'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      // 使っている作品・プロジェクトの数（A7）が変わりうる
      void queryClient.invalidateQueries({ queryKey: STACKS_LIST_KEY })
      // 新規作成で初めて保存したら、URL を作成した項目のものに置き換える（SDD 4.1）
      if (created) {
        onCreated(output.id)
        await session.leave(() => navigate({ to: `${config.listHref}/$id`, params: { id: output.id }, replace: true }))
      }
    }
    if (kind === 'work') {
      const body = { ...common, githubUrl }
      return save.run(action, {
        check: () => checkWithSchema(workInput, body),
        request: () => (saved === null ? api.works.create(body) : api.works.update({ params: { id: saved.id }, body })),
        onSuccess,
      })
    }
    const body = { ...common, startDate, endDate }
    return save.run(action, {
      check: () => checkWithSchema(projectInput, body),
      request: () =>
        saved === null ? api.projects.create(body) : api.projects.update({ params: { id: saved.id }, body }),
      onSuccess,
    })
  }

  async function remove() {
    if (saved === null) return
    save.setPending('delete')
    try {
      if (kind === 'work') await api.works.remove({ params: { id: saved.id } })
      else await api.projects.remove({ params: { id: saved.id } })
      session.clear()
      // 消した項目を読み直すと NOT_FOUND になり、一覧へ移る前に「見つかりませんでした」が出うるので、読み直さずに捨てる
      queryClient.removeQueries({ queryKey: [config.queryKey, 'item', saved.id] })
      void queryClient.invalidateQueries({ queryKey: [config.queryKey, 'list'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: STACKS_LIST_KEY })
      await session.leave(() => navigate({ to: config.listHref }))
      toaster.create({ title: NOTICES.deleted, type: 'success' })
    } catch (error) {
      if (!isAuthError(error)) toaster.create({ title: NOTICES.deleteFailed, type: 'error' })
      save.setPending(null)
      flow.closeConfirm()
    }
  }

  const title = saved === null ? newItemTitle(config.name) : displayTitle({ ja: saved.ja.title, en: saved.en.title })
  const flow = usePublishFlow({
    title,
    pending: save.pending,
    slugChanged: () => slugChanged(everPublished, saved?.slug ?? null, form.state.values.slug),
    submit,
    remove,
    shortcut: editor.shortcut,
  })
  const languages = languagesOf('title', values.ja, values.en)

  const localized = (fieldLang: Lang) => (
    <>
      <form.Field name={`${fieldLang}.title`}>
        {(field) => (
          <TextField
            label="タイトル"
            bare="title"
            limit={LIMITS.shortText}
            name={field.name}
            value={field.state.value}
            onChange={field.handleChange}
            lang={fieldLang}
            {...save.fieldState(field.name)}
          />
        )}
      </form.Field>
      <form.Field name={`${fieldLang}.summary`}>
        {(field) => (
          <TextAreaField
            label="概要"
            bare="summary"
            limit={LIMITS.summary}
            rows={2}
            name={field.name}
            value={field.state.value}
            onChange={field.handleChange}
            lang={fieldLang}
            {...save.fieldState(field.name)}
          />
        )}
      </form.Field>
    </>
  )

  const settings = (
    <>
      <form.Field name="slug">
        {(field) => (
          <SlugField
            type={kind}
            excludeId={saved?.id ?? null}
            name={field.name}
            value={field.state.value}
            onChange={field.handleChange}
            englishTitle={values.en.title}
            everPublished={everPublished}
            savedSlug={saved?.slug ?? null}
            {...save.fieldState(field.name)}
          />
        )}
      </form.Field>
      {kind === 'project' && (
        <>
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
        </>
      )}
      <form.Field name="linkUrl">
        {(field) => (
          <TextField
            label="外部リンク"
            type="url"
            placeholder="https://"
            name={field.name}
            value={field.state.value}
            onChange={field.handleChange}
            {...save.fieldState(field.name)}
          />
        )}
      </form.Field>
      {kind === 'work' && (
        <form.Field name="githubUrl">
          {(field) => (
            <TextField
              label="GitHub"
              type="url"
              placeholder="https://"
              name={field.name}
              value={field.state.value}
              onChange={field.handleChange}
              {...save.fieldState(field.name)}
            />
          )}
        </form.Field>
      )}
      <form.Field name="stacks">
        {(field) => (
          <StackPicker
            value={field.state.value}
            onChange={field.handleChange}
            errors={save.fieldState('stackIds').errors}
          />
        )}
      </form.Field>
      <form.Field name="thumbnailUrl">
        {(field) => (
          <ImageField
            label="サムネイル"
            fit="thumbnail"
            name={field.name}
            value={field.state.value}
            onChange={field.handleChange}
            alt={displayTitle({ ja: values.ja.title || null, en: values.en.title || null })}
            {...save.fieldState(field.name)}
          />
        )}
      </form.Field>
    </>
  )

  return (
    <editor.BusyProvider>
      <LongFormEditView
        back={<BackLink href={config.listHref}>{config.name}</BackLink>}
        title={title}
        status={editor.status}
        saveStatus={editor.saveStatus}
        reason={editor.reason}
        pending={save.pending}
        layout={layout}
        languages={languages}
        problems={{ ja: save.hasProblemIn('ja'), en: save.hasProblemIn('en') }}
        notices={
          <>
            {session.offer !== null && (
              <RestoreBanner offer={session.offer} onRestore={session.restoreOffer} onDiscard={session.discardOffer} />
            )}
            <SaveProblems missing={save.missing} formErrors={save.formErrors} fieldLabels={FIELD_LABELS} />
          </>
        }
        localized={localized}
        body={{
          label: '詳細本文',
          values: { ja: values.ja.body, en: values.en.body },
          onChange: (bodyLang, value) => form.setFieldValue(`${bodyLang}.body`, value),
          fieldState: (bodyLang) => save.fieldState(`${bodyLang}.body`),
        }}
        settings={settings}
        settingsInvalid={save.hasProblemInAny(SETTINGS_KEYS[kind])}
        actions={flow}
      >
        {session.leaveDialog}
      </LongFormEditView>
    </editor.BusyProvider>
  )
}

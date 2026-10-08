/**
 * A8 ブログ管理・A9 コーディング記録管理（design-spec 6.6・6.7、SDD 5.9）。一覧は L4、編集は L5。
 * 形の違いは、コーディング記録が種類と参考リンクを持つことだけなので、1つの部品で両方を扱う
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { css, cx } from 'styled-system/css'
import { z } from 'zod'
import { LIMITS } from '~/api/contract/common'
import { blogPostInput, type blogPostOutput, codingLogInput, type codingLogOutput } from '~/api/contract/posts'
import { CODING_LOG_KINDS } from '~/db/enums'
import { languagesOf } from '~/domain/languages'
import type { Status, Transition } from '~/domain/publishing'
import type { Lang } from '~/i18n/detect'
import { formatAdminDate, fromTokyoDateTimeInput, toTokyoDateTimeInput } from '~/i18n/format'
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
import { ImageField, SelectField, TextField } from './fields'
import {
  CODING_LOG_KIND_LABELS,
  displayTitle,
  languagesLabel,
  listLabel,
  NOTICES,
  newItemTitle,
  SECTION_LABELS,
  STATUS_LABELS,
} from './labels'
import { FormLayout, ListLayout, SplitEditSkeleton } from './layouts'
import { AdminLink } from './link'
import { AdminList } from './list-view'
import { LongFormEditView, SlugField, slugChanged, useLongFormView } from './long-form'
import { ALL } from './search'

export type PostKind = 'blog-post' | 'coding-log'
type CodingLogKind = (typeof CODING_LOG_KINDS)[number]

type BlogPost = z.infer<typeof blogPostOutput>
type CodingLog = z.infer<typeof codingLogOutput>
type Post = BlogPost | CodingLog

const KINDS = {
  'blog-post': {
    name: SECTION_LABELS.blog,
    listHref: '/admin/blog',
    queryKey: 'blog-posts',
    publicPath: (slug: string) => `/ja/blog/${slug}`,
  },
  'coding-log': {
    name: SECTION_LABELS.coding,
    listHref: '/admin/coding',
    queryKey: 'coding-logs',
    publicPath: (slug: string) => `/ja/coding/${slug}`,
  },
} as const

export interface PostsSearch {
  status?: Status
  /** コーディング記録だけ */
  kind?: CodingLogKind
}

// ---- 一覧 ------------------------------------------------------------------

interface PostListItem {
  id: string
  slug: string | null
  status: Status
  ja: { title: string | null }
  en: { title: string | null }
  languages: { ja: boolean; en: boolean }
  publishedAt: string | null
  updatedAt: string
  kind?: CodingLogKind
}

function listItems(kind: PostKind, search: PostsSearch): Promise<{ items: PostListItem[] }> {
  return kind === 'blog-post'
    ? api.blogPosts.list({ status: search.status })
    : api.codingLogs.list({ status: search.status, kind: search.kind })
}

export function PostsListPage({ kind, search }: { kind: PostKind; search: PostsSearch }) {
  const config = KINDS[kind]
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: [config.queryKey, 'list', search], queryFn: () => listItems(kind, search) })
  const setSearch = (next: PostsSearch) => navigate({ to: config.listHref, search: next, replace: true })
  const titleOf = (item: PostListItem) => displayTitle({ ja: item.ja.title, en: item.en.title })

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
              setSearch({ ...search, status: value === 'draft' || value === 'published' ? value : undefined })
            }
          />
          {kind === 'coding-log' && (
            <Select
              label="種類"
              options={[
                { value: ALL, label: 'すべて' },
                ...CODING_LOG_KINDS.map((value) => ({ value, label: CODING_LOG_KIND_LABELS[value] })),
              ]}
              value={search.kind ?? ALL}
              onValueChange={(value) =>
                setSearch({ ...search, kind: CODING_LOG_KINDS.find((candidate) => candidate === value) })
              }
            />
          )}
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
          ...(kind === 'coding-log'
            ? [
                {
                  key: 'kind',
                  header: '種類',
                  cell: (item: PostListItem) => (item.kind === undefined ? '' : CODING_LOG_KIND_LABELS[item.kind]),
                },
              ]
            : []),
          { key: 'title', header: 'タイトル', primary: true, mobile: true, cell: titleOf },
          {
            key: 'status',
            header: '状態',
            mobile: true,
            cell: (item) => <StatusBadge status={item.status} />,
          },
          { key: 'languages', header: '言語', cell: (item) => languagesLabel(item.languages) },
          {
            key: 'publishedAt',
            header: '公開日',
            cell: (item) => (item.publishedAt === null ? '—' : formatAdminDate(item.publishedAt)),
          },
          { key: 'updatedAt', header: '最終保存日', cell: (item) => formatAdminDate(item.updatedAt) },
        ]}
        getId={(item) => item.id}
        getTitle={titleOf}
        editHref={(item) => `${config.listHref}/${item.id}`}
        // 公開中のものはスラッグを必ず持つ（公開のルール。design-spec 6.7.3）
        publicHref={(item) => (item.status === 'published' && item.slug !== null ? config.publicPath(item.slug) : null)}
        onDelete={async (item) => {
          if (kind === 'blog-post') await api.blogPosts.remove({ params: { id: item.id } })
          else await api.codingLogs.remove({ params: { id: item.id } })
          await queryClient.invalidateQueries({ queryKey: [config.queryKey] })
          void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
        }}
        filtered={search.status !== undefined || search.kind !== undefined}
        onClearFilter={() => setSearch({})}
        newHref={`${config.listHref}/new`}
      />
    </ListLayout>
  )
}

// ---- 編集 ------------------------------------------------------------------

const localizedForm = z.object({ title: z.string(), body: z.string() })
const postFormSchema = z.object({
  slug: z.string(),
  ja: localizedForm,
  en: localizedForm,
  thumbnailUrl: z.string(),
  /** 日時の入力欄の値（日本時間）。空なら未設定 */
  publishedAt: z.string(),
  /** コーディング記録だけ */
  kind: z.enum(CODING_LOG_KINDS),
  referenceUrl: z.string(),
})
type PostForm = z.infer<typeof postFormSchema>

const parsePostForm = (value: unknown): PostForm | null => postFormSchema.safeParse(value).data ?? null

const emptyLocalized = { title: '', body: '' }

function toForm(post: Post | null): PostForm {
  if (post === null) {
    return {
      slug: '',
      ja: emptyLocalized,
      en: emptyLocalized,
      thumbnailUrl: '',
      publishedAt: '',
      kind: 'learning_log',
      referenceUrl: '',
    }
  }
  const localized = (lang: Lang) => ({ title: post[lang].title ?? '', body: post[lang].body ?? '' })
  return {
    slug: post.slug ?? '',
    ja: localized('ja'),
    en: localized('en'),
    thumbnailUrl: post.thumbnailUrl ?? '',
    publishedAt: post.publishedAt === null ? '' : toTokyoDateTimeInput(post.publishedAt),
    kind: 'kind' in post ? post.kind : 'learning_log',
    referenceUrl: 'referenceUrl' in post ? (post.referenceUrl ?? '') : '',
  }
}

function getItem(kind: PostKind, id: string): Promise<Post> {
  return kind === 'blog-post' ? api.blogPosts.get({ params: { id } }) : api.codingLogs.get({ params: { id } })
}

const FIELD_LABELS = { title: 'タイトル', body: '本文', slug: 'スラッグ' }

/** 設定パネルの欄（design-spec 6.7 の「L5 の欄の置き場所」） */
const SETTINGS_KEYS: Record<PostKind, readonly string[]> = {
  'blog-post': ['slug', 'publishedAt', 'thumbnailUrl'],
  'coding-log': ['slug', 'kind', 'publishedAt', 'referenceUrl', 'thumbnailUrl'],
}

const LOCALIZED_KEYS = ['ja.title', 'en.title', 'ja.body', 'en.body']

function disabledActions() {
  return <PublishActions status={null} pending={null} disabled onSave={() => {}} onUnpublish={() => {}} />
}

export function PostEditPage({ kind, id }: { kind: PostKind; id: string }) {
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
    <PostEditor
      key={editor.key}
      onCreated={editor.markCreated}
      kind={kind}
      initial={isNew ? null : (query.data ?? null)}
    />
  )
}

function PostEditor({
  kind,
  initial,
  onCreated,
}: {
  kind: PostKind
  initial: Post | null
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
    parseValues: parsePostForm,
    idOf: (item) => item.id,
    updatedAtOf: (item) => item.updatedAt,
    saveKind: 'publishable',
    statusOf: (item) => item.status,
    fieldOrder: [...LOCALIZED_KEYS, ...SETTINGS_KEYS[kind]],
    reveal: layout.reveal,
  })
  const { form, values, saved, save, session } = editor
  // 公開したことがあるか: 公開日が記録されていること（design-spec 6.7.2）
  const everPublished = saved?.publishedAt != null

  /**
   * 公開日の欄は分までなので、触っていなければ保存してある値（秒・ミリ秒を含む）をそのまま送る。
   * 入力欄の値を送り直すと、保存のたびに公開日の秒が切り捨てられる
   */
  function publishedAtOf(input: string): string | null {
    if (saved?.publishedAt != null && input === toTokyoDateTimeInput(saved.publishedAt)) return saved.publishedAt
    return fromTokyoDateTimeInput(input)
  }

  function submit(action: Transition) {
    const sent = form.state.values
    const status: Status = action === 'publish' || action === 'update' ? 'published' : 'draft'
    const { kind: logKind, referenceUrl, publishedAt, ...rest } = sent
    const common = { ...rest, status, publishedAt: publishedAtOf(publishedAt) }
    const onSuccess = async (output: Post) => {
      const created = editor.applySaved(output, sent)
      queryClient.setQueryData([config.queryKey, 'item', output.id], output)
      void queryClient.invalidateQueries({ queryKey: [config.queryKey, 'list'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      // 新規作成で初めて保存したら、URL を作成した項目のものに置き換える（SDD 4.1）
      if (created) {
        onCreated(output.id)
        await session.leave(() => navigate({ to: `${config.listHref}/$id`, params: { id: output.id }, replace: true }))
      }
    }
    if (kind === 'blog-post') {
      return save.run(action, {
        check: () => checkWithSchema(blogPostInput, common),
        request: () =>
          saved === null
            ? api.blogPosts.create(common)
            : api.blogPosts.update({ params: { id: saved.id }, body: common }),
        onSuccess,
      })
    }
    const body = { ...common, kind: logKind, referenceUrl }
    return save.run(action, {
      check: () => checkWithSchema(codingLogInput, body),
      request: () =>
        saved === null ? api.codingLogs.create(body) : api.codingLogs.update({ params: { id: saved.id }, body }),
      onSuccess,
    })
  }

  async function remove() {
    if (saved === null) return
    save.setPending('delete')
    try {
      if (kind === 'blog-post') await api.blogPosts.remove({ params: { id: saved.id } })
      else await api.codingLogs.remove({ params: { id: saved.id } })
      session.clear()
      // 消した項目を読み直すと NOT_FOUND になり、一覧へ移る前に「見つかりませんでした」が出うるので、読み直さずに捨てる
      queryClient.removeQueries({ queryKey: [config.queryKey, 'item', saved.id] })
      void queryClient.invalidateQueries({ queryKey: [config.queryKey, 'list'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
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
  const languages = languagesOf('titleAndBody', values.ja, values.en)

  const localized = (fieldLang: Lang) => (
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
      {kind === 'coding-log' && (
        <form.Field name="kind">
          {(field) => (
            <SelectField
              label="種類"
              name={field.name}
              options={CODING_LOG_KINDS.map((value) => ({ value, label: CODING_LOG_KIND_LABELS[value] }))}
              value={field.state.value}
              onChange={(value) => {
                const next = CODING_LOG_KINDS.find((candidate) => candidate === value)
                if (next) field.handleChange(next)
              }}
              {...save.fieldState(field.name)}
            />
          )}
        </form.Field>
      )}
      <form.Field name="publishedAt">
        {(field) => (
          <TextField
            label="公開日"
            type="datetime-local"
            // 公開日を入れられるのは公開した後（SDD 5.9）。今より後にはできない（design-spec 6.7.3）
            disabled={!everPublished}
            max={toTokyoDateTimeInput(new Date())}
            hint={everPublished ? '日本時間' : '公開すると今の日時が入ります'}
            name={field.name}
            value={field.state.value}
            onChange={field.handleChange}
            {...save.fieldState(field.name)}
          />
        )}
      </form.Field>
      {kind === 'coding-log' && (
        <form.Field name="referenceUrl">
          {(field) => (
            <TextField
              label="参考リンク"
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
          label: '本文',
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

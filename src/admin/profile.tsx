/**
 * A3 プロフィール編集（design-spec 6.7.2、SDD 5.5）。L6 で「保存」だけを置く。まだプロフィールがなければ空のフォーム
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { css, cx } from 'styled-system/css'
import type { z } from 'zod'
import { LIMITS } from '~/api/contract/common'
import { profileInput, type profileOutput } from '~/api/contract/profile'
import { SOCIAL_SERVICES } from '~/db/enums'
import { languagesOf } from '~/domain/languages'
import type { Lang } from '~/i18n/detect'
import type { MarkdownStack } from '~/markdown/render'
import { CloseIcon, PlusIcon } from '~/ui/icons'
import { button } from '~/ui/recipes'
import { api } from './api'
import {
  checkWithSchema,
  EditLoadError,
  EditLoading,
  LocalizedFields,
  RestoreBanner,
  SaveActions,
  SaveProblems,
  SaveStatus,
  useEditor,
  useLocalizedView,
  useSaveShortcut,
} from './editor'
import { isNotFoundError } from './errors'
import { fieldLabel, ImageField, MarkdownField, SelectField, TextField } from './fields'
import { FormLayout } from './layouts'
import { FIELD_ORDER, parseProfileForm, toBody, toForm } from './profile-form'
import { SortableList } from './sortable'

type Profile = z.infer<typeof profileOutput>
type SocialService = (typeof SOCIAL_SERVICES)[number]

const SERVICE_LABELS: Record<SocialService, string> = {
  github: 'GitHub',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  x: 'X',
  zenn: 'Zenn',
  qiita: 'Qiita',
  other: 'その他',
}

/**
 * 保存した内容と比べるときの形。SNS リンクの id は並べ替えの目印で、開くたびに作り直すので比べない
 * （比べると、開き直すたびに退避がサーバーの内容と違って見える）
 */
const comparable = toBody

const TITLE = 'プロフィール'

export function ProfilePage() {
  const query = useQuery({ queryKey: ['profile'], queryFn: () => api.profile.get() })
  // 自己紹介のプレビューで、太字と照合する使用技術（ADR-012）。A7 の一覧と同じキーで読み、キャッシュを共有する
  const stacksQuery = useQuery({ queryKey: ['stacks', 'list'], queryFn: () => api.stacks.list() })
  const disabledActions = <SaveActions pending={null} disabled onSave={() => {}} />

  if (query.status === 'pending' || stacksQuery.status === 'pending') {
    return (
      <FormLayout title={TITLE} actions={disabledActions}>
        <EditLoading />
      </FormLayout>
    )
  }
  // プロフィールがまだないときは NOT_FOUND。空のフォームを出し、初めて保存したときに作る（design-spec 6.7.4）
  if ((query.status === 'error' && !isNotFoundError(query.error)) || stacksQuery.status === 'error') {
    return (
      <FormLayout title={TITLE} actions={disabledActions}>
        <EditLoadError
          onRetry={() => {
            if (query.status === 'error') void query.refetch()
            if (stacksQuery.status === 'error') void stacksQuery.refetch()
          }}
        />
      </FormLayout>
    )
  }
  // items をそのまま渡す。描画のたびに作り直すと、プレビューが描画のたびに描き直す（TanStack Query は同じ中身なら同じ配列を返す）
  return <ProfileEditor initial={query.data ?? null} stacks={stacksQuery.data.items} />
}

function ProfileEditor({ initial, stacks }: { initial: Profile | null; stacks: MarkdownStack[] }) {
  const queryClient = useQueryClient()
  const localizedView = useLocalizedView()
  const editor = useEditor({
    initial,
    toForm,
    backupType: 'profile',
    parseValues: parseProfileForm,
    comparable,
    idOf: (item) => item.id,
    updatedAtOf: (item) => item.updatedAt,
    saveKind: 'plain',
    fieldOrder: FIELD_ORDER,
    reveal: localizedView.reveal,
  })
  const { form, values, save, session } = editor

  function submit() {
    const sent = form.state.values
    const body = toBody(sent)
    return save.run('save', {
      check: () => checkWithSchema(profileInput, body),
      request: () => api.profile.update(body),
      onSuccess: (output) => {
        editor.applySaved(output, sent)
        queryClient.setQueryData(['profile'], output)
      },
    })
  }

  useSaveShortcut(
    () => editor.shortcut(false),
    () => void submit(),
  )

  const languages = languagesOf('name', values.ja, values.en)
  const localized = (lang: Lang) => (
    <>
      <form.Field name={`${lang}.name`}>
        {(field) => (
          <TextField
            label="名前"
            limit={LIMITS.shortText}
            name={field.name}
            value={field.state.value}
            onChange={field.handleChange}
            lang={lang}
            {...save.fieldState(field.name)}
          />
        )}
      </form.Field>
      <form.Field name={`${lang}.headline`}>
        {(field) => (
          <TextField
            label="肩書き"
            limit={LIMITS.shortText}
            name={field.name}
            value={field.state.value}
            onChange={field.handleChange}
            lang={lang}
            {...save.fieldState(field.name)}
          />
        )}
      </form.Field>
      <form.Field name={`${lang}.tagline`}>
        {(field) => (
          <TextField
            label="一言"
            limit={LIMITS.shortText}
            name={field.name}
            value={field.state.value}
            onChange={field.handleChange}
            lang={lang}
            {...save.fieldState(field.name)}
          />
        )}
      </form.Field>
      <form.Field name={`${lang}.bio`}>
        {(field) => (
          <MarkdownField
            label="自己紹介"
            name={field.name}
            value={field.state.value}
            onChange={field.handleChange}
            lang={lang}
            stacks={stacks}
            {...save.fieldState(field.name)}
          />
        )}
      </form.Field>
    </>
  )

  return (
    <editor.BusyProvider>
      <FormLayout
        title={TITLE}
        status={<SaveStatus {...editor.saveStatus} />}
        formView={{ value: localizedView.view, onChange: localizedView.setView }}
        actions={<SaveActions pending={save.pending} reason={editor.reason} onSave={() => void submit()} />}
      >
        {session.offer !== null && (
          <RestoreBanner offer={session.offer} onRestore={session.restoreOffer} onDiscard={session.discardOffer} />
        )}
        <SaveProblems missing={save.missing} formErrors={save.formErrors} fieldLabels={{}} />
        <LocalizedFields
          state={localizedView}
          languages={languages}
          problems={{ ja: save.hasProblemIn('ja'), en: save.hasProblemIn('en') }}
          render={localized}
        />
        <form.Field name="avatarUrl">
          {(field) => (
            <ImageField
              label="写真"
              name={field.name}
              value={field.state.value}
              onChange={field.handleChange}
              alt={values.ja.name || values.en.name}
              {...save.fieldState(field.name)}
            />
          )}
        </form.Field>
        <form.Field name="socialLinks" mode="array">
          {(linksField) => (
            <fieldset
              data-field="socialLinks"
              className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}
            >
              <legend className={cx(fieldLabel, css({ mb: 'inline' }))}>SNSリンク</legend>
              <SortableList
                label="SNSリンクの並び"
                items={linksField.state.value}
                getId={(link) => link.id}
                getLabel={(link, index) => `${SERVICE_LABELS[link.service]}（${index + 1}番目）`}
                onMove={(from, to) => linksField.moveValue(from, to)}
                renderItem={(link, index, handle) => (
                  <div
                    className={css({
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'flex-start',
                      gap: 'inline',
                      p: 'inset-dense',
                      borderWidth: 'default',
                      borderStyle: 'solid',
                      borderColor: 'border.default',
                      borderRadius: 'control',
                    })}
                  >
                    {handle}
                    <form.Field name={`socialLinks[${index}].service`}>
                      {(field) => (
                        <SelectField
                          label="サービス"
                          name={field.name}
                          options={SOCIAL_SERVICES.map((service) => ({
                            value: service,
                            label: SERVICE_LABELS[service],
                          }))}
                          value={field.state.value}
                          onChange={(value) => {
                            const service = SOCIAL_SERVICES.find((candidate) => candidate === value)
                            if (service) field.handleChange(service)
                          }}
                          {...save.fieldState(field.name)}
                        />
                      )}
                    </form.Field>
                    <div className={css({ flex: '1', minW: 'popover' })}>
                      <form.Field name={`socialLinks[${index}].url`}>
                        {(field) => (
                          <TextField
                            label="URL"
                            type="url"
                            placeholder="https://"
                            name={field.name}
                            value={field.state.value}
                            onChange={field.handleChange}
                            {...save.fieldState(field.name)}
                          />
                        )}
                      </form.Field>
                    </div>
                    {link.service === 'other' && (
                      <form.Field name={`socialLinks[${index}].label`}>
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
                    )}
                    <button
                      type="button"
                      onClick={() => linksField.removeValue(index)}
                      aria-label={`「${SERVICE_LABELS[link.service]}（${index + 1}番目）」を削除`}
                      className={button({ variant: 'ghost', shape: 'icon' })}
                    >
                      <CloseIcon size="sm" />
                    </button>
                  </div>
                )}
              />
              <button
                type="button"
                onClick={() => linksField.pushValue({ id: crypto.randomUUID(), service: 'github', url: '', label: '' })}
                className={css(button.raw({ variant: 'outline' }), { alignSelf: 'flex-start' })}
              >
                <PlusIcon size="sm" />
                SNSリンクを追加
              </button>
            </fieldset>
          )}
        </form.Field>
        {session.leaveDialog}
      </FormLayout>
    </editor.BusyProvider>
  )
}

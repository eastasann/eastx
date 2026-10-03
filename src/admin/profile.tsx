/**
 * A3 プロフィール編集（design-spec 6.7.2、SDD 5.5）。L6 で「保存」だけを置く。まだプロフィールがなければ空のフォーム
 */
import { useForm, useStore } from '@tanstack/react-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { css } from 'styled-system/css'
import { z } from 'zod'
import { profileInput, type profileOutput } from '~/api/contract/profile'
import { SOCIAL_SERVICES } from '~/db/schema'
import { languagesOf } from '~/domain/languages'
import type { Lang } from '~/i18n/detect'
import { CloseIcon, PlusIcon } from '~/ui/icons'
import { button } from '~/ui/recipes'
import { api } from './api'
import { backupKey } from './backup'
import {
  checkWithSchema,
  EditLoadError,
  EditLoading,
  LanguageTabs,
  RestoreBanner,
  SaveActions,
  SaveProblems,
  useEditSession,
  useSaveState,
} from './editor'
import { isNotFoundError } from './errors'
import { ImageField, MarkdownField, SelectField, TextField } from './fields'
import { FormLayout } from './layouts'
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

const localizedForm = z.object({ name: z.string(), headline: z.string(), bio: z.string() })
const profileFormSchema = z.object({
  ja: localizedForm,
  en: localizedForm,
  avatarUrl: z.string(),
  socialLinks: z.array(
    // id は並べ替えの目印だけに使い、API には送らない
    z.object({ id: z.string(), service: z.enum(SOCIAL_SERVICES), url: z.string(), label: z.string() }),
  ),
})
type ProfileForm = z.infer<typeof profileFormSchema>

const isProfileForm = (value: unknown): value is ProfileForm => profileFormSchema.safeParse(value).success

function toForm(profile: Profile | null): ProfileForm {
  const localized = (lang: Lang) => ({
    name: profile?.[lang].name ?? '',
    headline: profile?.[lang].headline ?? '',
    bio: profile?.[lang].bio ?? '',
  })
  return {
    ja: localized('ja'),
    en: localized('en'),
    avatarUrl: profile?.avatarUrl ?? '',
    socialLinks: (profile?.socialLinks ?? []).map((link) => ({
      id: crypto.randomUUID(),
      service: link.service,
      url: link.url,
      label: link.label ?? '',
    })),
  }
}

function toBody(values: ProfileForm) {
  return { ...values, socialLinks: values.socialLinks.map(({ id: _id, ...link }) => link) }
}

const TITLE = 'プロフィール'

export function ProfilePage() {
  const query = useQuery({ queryKey: ['profile'], queryFn: () => api.profile.get() })
  const disabledActions = <SaveActions pending={null} disabled onSave={() => {}} />

  if (query.status === 'pending') {
    return (
      <FormLayout title={TITLE}>
        <EditLoading actions={disabledActions} />
      </FormLayout>
    )
  }
  // プロフィールがまだないときは NOT_FOUND。空のフォームを出し、初めて保存したときに作る（design-spec 6.7.4）
  if (query.status === 'error' && !isNotFoundError(query.error)) {
    return (
      <FormLayout title={TITLE}>
        <EditLoadError onRetry={() => query.refetch()} actions={disabledActions} />
      </FormLayout>
    )
  }
  return <ProfileEditor initial={query.data ?? null} />
}

function ProfileEditor({ initial }: { initial: Profile | null }) {
  const queryClient = useQueryClient()
  const [saved, setSaved] = useState(initial)
  const [baseline, setBaseline] = useState(() => toForm(initial))
  const form = useForm({ defaultValues: baseline })
  const values = useStore(form.store, (state) => state.values)
  const save = useSaveState()
  const session = useEditSession({
    getValues: () => form.state.values,
    baseline,
    backupKey: backupKey('profile', saved?.id ?? null),
    isValues: isProfileForm,
    restore: (restored) => form.reset(restored, { keepDefaultValues: true }),
  })

  function submit() {
    const body = toBody(form.state.values)
    return save.run('save', {
      check: () => checkWithSchema(profileInput, body),
      request: () => api.profile.update(body),
      onSuccess: (output) => {
        const next = toForm(output)
        setSaved(output)
        setBaseline(next)
        form.reset(next)
        session.clearBackup()
        queryClient.setQueryData(['profile'], output)
      },
    })
  }

  const languages = languagesOf('name', values.ja, values.en)
  const panel = (lang: Lang) => (
    <>
      <form.Field name={`${lang}.name`}>
        {(field) => (
          <TextField
            label="名前"
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
            {...save.fieldState(field.name)}
          />
        )}
      </form.Field>
    </>
  )

  return (
    <FormLayout title={TITLE} actions={<SaveActions pending={save.pending} onSave={() => void submit()} />}>
      {session.offer !== null && <RestoreBanner onRestore={session.restoreOffer} onDiscard={session.discardOffer} />}
      <SaveProblems missing={save.missing} formErrors={save.formErrors} fieldLabels={{}} />
      <LanguageTabs
        languages={languages}
        problems={{ ja: save.hasProblemIn('ja'), en: save.hasProblemIn('en') }}
        panels={{ ja: panel('ja'), en: panel('en') }}
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
          <fieldset className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}>
            <legend className={css({ textStyle: 'label', mb: 'inline' })}>SNSリンク</legend>
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
                        options={SOCIAL_SERVICES.map((service) => ({ value: service, label: SERVICE_LABELS[service] }))}
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
  )
}

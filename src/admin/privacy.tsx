/**
 * A11 プライバシー編集（design-spec 6.7.2、SDD 5.12）。L6 で「保存」だけを置く。まだ行がなければ空のフォーム
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { css } from 'styled-system/css'
import type { z } from 'zod'
import { privacyInput, type privacyOutput } from '~/api/contract/privacy'
import { hasPrivacyPage, languagesOf } from '~/domain/languages'
import type { Lang } from '~/i18n/detect'
import { ExternalLinkIcon } from '~/ui/icons'
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
import { MarkdownField } from './fields'
import { FormLayout } from './layouts'
import { BACKUP_TYPE, FIELD_ORDER, parsePrivacyForm, savedNotice, toBody, toForm } from './privacy-form'

type Privacy = z.infer<typeof privacyOutput>

const TITLE = 'プライバシー'

export function PrivacyPage() {
  const query = useQuery({ queryKey: ['privacy'], queryFn: () => api.privacy.get() })
  const disabledActions = <SaveActions pending={null} disabled onSave={() => {}} />

  if (query.status === 'pending') {
    return (
      <FormLayout title={TITLE} actions={disabledActions}>
        <EditLoading />
      </FormLayout>
    )
  }
  // 行がまだないときは NOT_FOUND。空のフォームを出し、初めて保存したときに作る（design-spec 6.7.4）
  if (query.status === 'error' && !isNotFoundError(query.error)) {
    return (
      <FormLayout title={TITLE} actions={disabledActions}>
        <EditLoadError onRetry={() => void query.refetch()} />
      </FormLayout>
    )
  }
  return <PrivacyEditor initial={query.data ?? null} />
}

function PrivacyEditor({ initial }: { initial: Privacy | null }) {
  const queryClient = useQueryClient()
  const localizedView = useLocalizedView()
  const editor = useEditor({
    initial,
    toForm,
    backupType: BACKUP_TYPE,
    parseValues: parsePrivacyForm,
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
      check: () => checkWithSchema(privacyInput, body),
      request: () => api.privacy.update(body),
      onSuccess: (output) => {
        editor.applySaved(output, sent)
        queryClient.setQueryData(['privacy'], output)
      },
      notice: savedNotice,
    })
  }

  useSaveShortcut(
    () => editor.shortcut(false),
    () => void submit(),
  )

  const languages = languagesOf('body', values.ja, values.en)
  const localized = (lang: Lang) => (
    <form.Field name={`${lang}.body`}>
      {(field) => (
        <MarkdownField
          label="本文"
          name={field.name}
          value={field.state.value}
          onChange={field.handleChange}
          lang={lang}
          rows={16}
          {...save.fieldState(field.name)}
        />
      )}
    </form.Field>
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
        {/* 保存済みの本文があるときだけ（入力中の本文ではなく、公開サイトに今出ているかで決める） */}
        {hasPrivacyPage(editor.saved) && (
          <a
            href="/ja/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className={css({
              display: 'inline-flex',
              alignItems: 'center',
              alignSelf: 'flex-start',
              gap: 'inline',
              textStyle: 'ui',
              color: 'link.default',
              textDecoration: 'underline',
              textDecorationColor: 'link.underline',
              _hover: { textDecorationColor: 'link.default' },
            })}
          >
            公開サイトで見る
            <ExternalLinkIcon size="sm" />
            <span className={css({ srOnly: true })}>（別タブで開く）</span>
          </a>
        )}
        {session.leaveDialog}
      </FormLayout>
    </editor.BusyProvider>
  )
}

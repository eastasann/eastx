/**
 * A11 プライバシー編集のフォームの値と、API との行き来（design-spec 6.7.2、SDD 5.12）
 */
import { z } from 'zod'
import type { privacyOutput } from '~/api/contract/privacy'
import { hasPrivacyPage } from '~/domain/languages'
import type { BackupType } from './backup'
import { NOTICES } from './labels'

type PrivacyPage = z.infer<typeof privacyOutput>

/** 自動退避の種類。キーは `eastx:backup:privacy:{id か new}`（SDD ADR-008） */
export const BACKUP_TYPE: BackupType = 'privacy'

const localizedForm = z.object({ body: z.string() })
const privacyFormSchema = z.object({ ja: localizedForm, en: localizedForm })
export type PrivacyForm = z.infer<typeof privacyFormSchema>

/** 退避の中身を今のフォームの形に読み直す。形が合わなければ null */
export const parsePrivacyForm = (value: unknown): PrivacyForm | null => privacyFormSchema.safeParse(value).data ?? null

export function toForm(page: PrivacyPage | null): PrivacyForm {
  return { ja: { body: page?.ja.body ?? '' }, en: { body: page?.en.body ?? '' } }
}

/** 空の本文は送ったあと API が null にする（SDD 5.0） */
export function toBody(values: PrivacyForm) {
  return { ja: { body: values.ja.body }, en: { body: values.en.body } }
}

/** 欄のキーの並び（画面の上から。誤りの欄へ移るときの順） */
export const FIELD_ORDER = ['ja.body', 'en.body']

/** 保存に成功したときの通知。日英とも空にしたら、公開サイトにページとリンクが出ないことを添える */
export function savedNotice(page: PrivacyPage): string {
  return hasPrivacyPage(page) ? NOTICES.saved : NOTICES.savedEmptyPrivacy
}

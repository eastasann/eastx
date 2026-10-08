/**
 * A3 プロフィール編集のフォームの値と、API との行き来（design-spec 6.7.2、SDD 5.5）
 */
import { z } from 'zod'
import type { profileOutput } from '~/api/contract/profile'
import { SOCIAL_SERVICES } from '~/db/enums'
import type { Lang } from '~/i18n/detect'

type Profile = z.infer<typeof profileOutput>

const localizedForm = z.object({
  name: z.string(),
  headline: z.string(),
  // 一言を足す前に退避した値にはキーが無い。空として復元する（design-spec 6.4）
  tagline: z.string().default(''),
  bio: z.string(),
})
const profileFormSchema = z.object({
  ja: localizedForm,
  en: localizedForm,
  avatarUrl: z.string(),
  socialLinks: z.array(
    // id は並べ替えの目印だけに使い、API には送らない
    z.object({ id: z.string(), service: z.enum(SOCIAL_SERVICES), url: z.string(), label: z.string() }),
  ),
})
export type ProfileForm = z.infer<typeof profileFormSchema>

/** 退避の中身を今のフォームの形に読み直す。形が合わなければ null */
export const parseProfileForm = (value: unknown): ProfileForm | null => profileFormSchema.safeParse(value).data ?? null

export function toForm(profile: Profile | null): ProfileForm {
  const localized = (lang: Lang) => ({
    name: profile?.[lang].name ?? '',
    headline: profile?.[lang].headline ?? '',
    tagline: profile?.[lang].tagline ?? '',
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

export function toBody(values: ProfileForm) {
  return { ...values, socialLinks: values.socialLinks.map(({ id: _id, ...link }) => link) }
}

/** 欄のキーの並び（画面の上から。誤りの欄へ移るときの順） */
export const FIELD_ORDER = [
  'ja.name',
  'ja.headline',
  'ja.tagline',
  'ja.bio',
  'en.name',
  'en.headline',
  'en.tagline',
  'en.bio',
  'avatarUrl',
  'socialLinks',
]

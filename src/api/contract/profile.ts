import { z } from 'zod'
import {
  base,
  httpsUrl,
  isoDateTime,
  LIMITS,
  languagesSchema,
  notFoundError,
  optionalMediaUrl,
  optionalText,
  socialServiceSchema,
} from './common'

const localized = z.object({
  name: optionalText(LIMITS.shortText),
  headline: optionalText(LIMITS.shortText),
  tagline: optionalText(LIMITS.shortText),
  bio: optionalText(LIMITS.markdown),
})

const socialLinkInput = z
  .object({
    service: socialServiceSchema,
    url: httpsUrl,
    label: optionalText(LIMITS.shortText),
  })
  .superRefine((link, ctx) => {
    if (link.service === 'other' && link.label === null) {
      ctx.addIssue({ code: 'custom', path: ['label'], message: '表示名を入力してください' })
    }
  })

export const profileInput = z
  .object({
    ja: localized,
    en: localized,
    avatarUrl: optionalMediaUrl,
    socialLinks: z.array(socialLinkInput).max(50),
  })
  .superRefine((value, ctx) => {
    // 名前は日英のどちらかに必須（design-spec 6.7.3）
    if (value.ja.name === null && value.en.name === null) {
      for (const lang of ['ja', 'en'] as const) {
        ctx.addIssue({
          code: 'custom',
          path: [lang, 'name'],
          message: '名前を日本語か英語のどちらかに入力してください',
        })
      }
    }
  })

const localizedOutput = z.object({
  name: z.string().nullable(),
  headline: z.string().nullable(),
  tagline: z.string().nullable(),
  bio: z.string().nullable(),
})

export const profileOutput = z.object({
  id: z.string(),
  ja: localizedOutput,
  en: localizedOutput,
  avatarUrl: z.string().nullable(),
  socialLinks: z.array(z.object({ service: socialServiceSchema, url: z.string(), label: z.string().nullable() })),
  languages: languagesSchema,
  updatedAt: isoDateTime,
})

export const profileContract = {
  get: base
    .route({ method: 'GET', path: '/profile', tags: ['profile'], summary: 'プロフィール（A3）' })
    .errors(notFoundError)
    .output(profileOutput),
  update: base
    .route({ method: 'PUT', path: '/profile', tags: ['profile'], summary: 'プロフィールの保存（なければ作る）' })
    .input(profileInput)
    .output(profileOutput),
}

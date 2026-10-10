import { z } from 'zod'
import { base, isoDateTime, LIMITS, languagesSchema, notFoundError, optionalText } from './common'

const localized = z.object({ body: optionalText(LIMITS.markdown) })

/** 本文は日英とも空でもよい（空にすると公開側にページもリンクも出なくなる。SDD 5.12） */
export const privacyInput = z.object({ ja: localized, en: localized })

const localizedOutput = z.object({ body: z.string().nullable() })

export const privacyOutput = z.object({
  id: z.string(),
  ja: localizedOutput,
  en: localizedOutput,
  languages: languagesSchema,
  updatedAt: isoDateTime,
})

export const privacyContract = {
  get: base
    .route({ method: 'GET', path: '/privacy', tags: ['privacy'], summary: 'プライバシーのページ（A11）' })
    .errors(notFoundError)
    .output(privacyOutput),
  update: base
    .route({
      method: 'PUT',
      path: '/privacy',
      tags: ['privacy'],
      summary: 'プライバシーのページの保存（なければ作る）',
    })
    .input(privacyInput)
    .output(privacyOutput),
}

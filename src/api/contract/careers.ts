import { z } from 'zod'
import {
  base,
  byIdRoute,
  careerKindSchema,
  idInput,
  idWithBody,
  isoDateTime,
  LIMITS,
  languagesSchema,
  notFoundError,
  optionalText,
  optionalYearMonth,
  periodRefinement,
  publishRequirementsError,
  statusSchema,
  titleRefinement,
} from './common'

const localized = z.object({
  title: optionalText(LIMITS.shortText),
  organization: optionalText(LIMITS.shortText),
  location: optionalText(LIMITS.shortText),
  body: optionalText(LIMITS.markdown),
})

const careerFields = {
  status: statusSchema,
  kind: careerKindSchema,
  startDate: optionalYearMonth,
  endDate: optionalYearMonth,
  ja: localized,
  en: localized,
}

export const careerInput = z.object(careerFields).superRefine(periodRefinement).superRefine(titleRefinement)

const localizedOutput = z.object({
  title: z.string().nullable(),
  organization: z.string().nullable(),
  location: z.string().nullable(),
  body: z.string().nullable(),
})

export const careerOutput = z.object({
  id: z.string(),
  kind: careerKindSchema,
  status: statusSchema,
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  ja: localizedOutput,
  en: localizedOutput,
  languages: languagesSchema,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
})

const listItem = z.object({
  id: z.string(),
  kind: careerKindSchema,
  status: statusSchema,
  ja: z.object({ title: z.string().nullable(), organization: z.string().nullable() }),
  en: z.object({ title: z.string().nullable(), organization: z.string().nullable() }),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  languages: languagesSchema,
  updatedAt: isoDateTime,
})

const tags = ['careers']

export const careersContract = {
  list: base
    .route({ method: 'GET', path: '/careers', tags, summary: '経歴の一覧（開始年月の新しい順。空の下書きが先頭）' })
    .input(z.object({ status: statusSchema.optional(), kind: careerKindSchema.optional() }))
    .output(z.object({ items: z.array(listItem) })),
  create: base
    .route({ method: 'POST', path: '/careers', successStatus: 201, tags, summary: '経歴の作成' })
    .errors(publishRequirementsError)
    .input(careerInput)
    .output(careerOutput),
  get: base
    .route({ method: 'GET', path: '/careers/{id}', ...byIdRoute, tags, summary: '経歴の1件' })
    .errors(notFoundError)
    .input(idInput)
    .output(careerOutput),
  update: base
    .route({ method: 'PUT', path: '/careers/{id}', ...byIdRoute, tags, summary: '経歴の更新・公開・非公開に戻す' })
    .errors({ ...notFoundError, ...publishRequirementsError })
    .input(idWithBody(careerInput))
    .output(careerOutput),
  remove: base
    .route({ method: 'DELETE', path: '/careers/{id}', ...byIdRoute, successStatus: 204, tags, summary: '経歴の削除' })
    .errors(notFoundError)
    .input(idInput)
    .output(z.void()),
}

/**
 * 作品（A5）とプロジェクト（A6）。形の違いは、作品が `githubUrl` を持ち、
 * プロジェクトが `startDate`・`endDate` を持つことだけ（SDD 5.7）。
 */
import { z } from 'zod'
import {
  base,
  byIdRoute,
  idInput,
  idWithBody,
  isoDateTime,
  LIMITS,
  languagesSchema,
  notFoundError,
  optionalHttpsUrl,
  optionalMediaUrl,
  optionalSlug,
  optionalText,
  optionalYearMonth,
  orderOutOfDateError,
  periodRefinement,
  publishRequirementsError,
  reorderInput,
  slugConflictError,
  statusSchema,
  titleRefinement,
} from './common'

const localized = z.object({
  title: optionalText(LIMITS.shortText),
  summary: optionalText(LIMITS.summary),
  body: optionalText(LIMITS.markdown),
})

const commonFields = {
  status: statusSchema,
  slug: optionalSlug,
  ja: localized,
  en: localized,
  linkUrl: optionalHttpsUrl,
  thumbnailUrl: optionalMediaUrl,
  /** この順で使用技術を紐づける（SDD 5.7） */
  stackIds: z
    .array(z.string().max(100))
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, '同じ技術が重複しています'),
}

const localizedOutput = z.object({
  title: z.string().nullable(),
  summary: z.string().nullable(),
  body: z.string().nullable(),
})

export const stackRefOutput = z.object({
  id: z.string(),
  key: z.string(),
  displayName: z.string(),
  iconUrl: z.string().nullable(),
})

const commonOutputFields = {
  id: z.string(),
  status: statusSchema,
  slug: z.string().nullable(),
  ja: localizedOutput,
  en: localizedOutput,
  linkUrl: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  stacks: z.array(stackRefOutput),
  sortOrder: z.number().int(),
  firstPublishedAt: isoDateTime.nullable(),
  hasDetail: z.boolean(),
  languages: languagesSchema,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
}

const commonListItemFields = {
  id: z.string(),
  slug: z.string().nullable(),
  status: statusSchema,
  ja: z.object({ title: z.string().nullable() }),
  en: z.object({ title: z.string().nullable() }),
  hasDetail: z.boolean(),
  languages: languagesSchema,
  sortOrder: z.number().int(),
  updatedAt: isoDateTime,
}

// ---- 作品 ---------------------------------------------------------------
const workFields = { ...commonFields, githubUrl: optionalHttpsUrl }
export const workInput = z.object(workFields).superRefine(titleRefinement)
export const workOutput = z.object({ ...commonOutputFields, githubUrl: z.string().nullable() })
const workListItem = z.object(commonListItemFields)

// ---- プロジェクト ---------------------------------------------------------
const projectFields = { ...commonFields, startDate: optionalYearMonth, endDate: optionalYearMonth }
export const projectInput = z.object(projectFields).superRefine(periodRefinement).superRefine(titleRefinement)
const periodOutput = { startDate: z.string().nullable(), endDate: z.string().nullable() }
export const projectOutput = z.object({ ...commonOutputFields, ...periodOutput })
const projectListItem = z.object({ ...commonListItemFields, ...periodOutput })

const saveErrors = { ...publishRequirementsError, ...slugConflictError }

export const worksContract = {
  list: base
    .route({ method: 'GET', path: '/works', tags: ['works'], summary: '作品の一覧（表示順）' })
    .input(z.object({ status: statusSchema.optional() }))
    .output(z.object({ items: z.array(workListItem) })),
  create: base
    .route({ method: 'POST', path: '/works', successStatus: 201, tags: ['works'], summary: '作品の作成（先頭に入る）' })
    .errors(saveErrors)
    .input(workInput)
    .output(workOutput),
  get: base
    .route({ method: 'GET', path: '/works/{id}', ...byIdRoute, tags: ['works'], summary: '作品の1件' })
    .errors(notFoundError)
    .input(idInput)
    .output(workOutput),
  update: base
    .route({
      method: 'PUT',
      path: '/works/{id}',
      ...byIdRoute,
      tags: ['works'],
      summary: '作品の更新・公開・非公開に戻す',
    })
    .errors({ ...notFoundError, ...saveErrors })
    .input(idWithBody(workInput))
    .output(workOutput),
  remove: base
    .route({
      method: 'DELETE',
      path: '/works/{id}',
      ...byIdRoute,
      successStatus: 204,
      tags: ['works'],
      summary: '作品の削除',
    })
    .errors(notFoundError)
    .input(idInput)
    .output(z.void()),
  reorder: base
    .route({ method: 'POST', path: '/works/reorder', tags: ['works'], summary: '作品の表示順' })
    .errors(orderOutOfDateError)
    .input(reorderInput)
    .output(reorderInput),
}

export const projectsContract = {
  list: base
    .route({ method: 'GET', path: '/projects', tags: ['projects'], summary: 'プロジェクトの一覧（表示順）' })
    .input(z.object({ status: statusSchema.optional() }))
    .output(z.object({ items: z.array(projectListItem) })),
  create: base
    .route({
      method: 'POST',
      path: '/projects',
      successStatus: 201,
      tags: ['projects'],
      summary: 'プロジェクトの作成（先頭に入る）',
    })
    .errors(saveErrors)
    .input(projectInput)
    .output(projectOutput),
  get: base
    .route({ method: 'GET', path: '/projects/{id}', ...byIdRoute, tags: ['projects'], summary: 'プロジェクトの1件' })
    .errors(notFoundError)
    .input(idInput)
    .output(projectOutput),
  update: base
    .route({
      method: 'PUT',
      path: '/projects/{id}',
      ...byIdRoute,
      tags: ['projects'],
      summary: 'プロジェクトの更新・公開・非公開に戻す',
    })
    .errors({ ...notFoundError, ...saveErrors })
    .input(idWithBody(projectInput))
    .output(projectOutput),
  remove: base
    .route({
      method: 'DELETE',
      path: '/projects/{id}',
      ...byIdRoute,
      successStatus: 204,
      tags: ['projects'],
      summary: 'プロジェクトの削除',
    })
    .errors(notFoundError)
    .input(idInput)
    .output(z.void()),
  reorder: base
    .route({ method: 'POST', path: '/projects/reorder', tags: ['projects'], summary: 'プロジェクトの表示順' })
    .errors(orderOutOfDateError)
    .input(reorderInput)
    .output(reorderInput),
}

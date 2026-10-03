/**
 * ブログ記事（A8）とコーディング記録（A9）。形の違いは、コーディング記録が `kind` と
 * `referenceUrl` を持つことだけ（SDD 5.9）。
 */
import { z } from 'zod'
import {
  base,
  byIdRoute,
  codingLogKindSchema,
  idInput,
  idWithBody,
  isoDateTime,
  LIMITS,
  languagesSchema,
  notFoundError,
  optionalDateTime,
  optionalHttpsUrl,
  optionalMediaUrl,
  optionalSlug,
  optionalText,
  publishRequirementsError,
  slugConflictError,
  statusSchema,
  titleRefinement,
} from './common'

const localized = z.object({
  title: optionalText(LIMITS.shortText),
  body: optionalText(LIMITS.markdown),
})

const commonFields = {
  status: statusSchema,
  slug: optionalSlug,
  ja: localized,
  en: localized,
  thumbnailUrl: optionalMediaUrl,
  /** 受け付ける値の制約は design-spec 6.7.3（src/domain/publishing.ts） */
  publishedAt: optionalDateTime,
}

const localizedOutput = z.object({ title: z.string().nullable(), body: z.string().nullable() })

const commonOutputFields = {
  id: z.string(),
  status: statusSchema,
  slug: z.string().nullable(),
  ja: localizedOutput,
  en: localizedOutput,
  thumbnailUrl: z.string().nullable(),
  publishedAt: isoDateTime.nullable(),
  contentUpdatedAt: isoDateTime.nullable(),
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
  languages: languagesSchema,
  publishedAt: isoDateTime.nullable(),
  updatedAt: isoDateTime,
}

// ---- ブログ記事 -----------------------------------------------------------
export const blogPostInput = z.object(commonFields).superRefine(titleRefinement)
export const blogPostOutput = z.object(commonOutputFields)

// ---- コーディング記録 ------------------------------------------------------
const codingLogFields = {
  ...commonFields,
  kind: codingLogKindSchema,
  referenceUrl: optionalHttpsUrl,
}
export const codingLogInput = z.object(codingLogFields).superRefine(titleRefinement)
export const codingLogOutput = z.object({
  ...commonOutputFields,
  kind: codingLogKindSchema,
  referenceUrl: z.string().nullable(),
})

const saveErrors = { ...publishRequirementsError, ...slugConflictError }
const listSummary = '一覧（下書きを最終保存日の新しい順で先頭に、続けて公開中を公開日の新しい順）'

export const blogPostsContract = {
  list: base
    .route({ method: 'GET', path: '/blog-posts', tags: ['blog-posts'], summary: `ブログ記事の${listSummary}` })
    .input(z.object({ status: statusSchema.optional() }))
    .output(z.object({ items: z.array(z.object(commonListItemFields)) })),
  create: base
    .route({
      method: 'POST',
      path: '/blog-posts',
      successStatus: 201,
      tags: ['blog-posts'],
      summary: 'ブログ記事の作成',
    })
    .errors(saveErrors)
    .input(blogPostInput)
    .output(blogPostOutput),
  get: base
    .route({ method: 'GET', path: '/blog-posts/{id}', ...byIdRoute, tags: ['blog-posts'], summary: 'ブログ記事の1件' })
    .errors(notFoundError)
    .input(idInput)
    .output(blogPostOutput),
  update: base
    .route({
      method: 'PUT',
      path: '/blog-posts/{id}',
      ...byIdRoute,
      tags: ['blog-posts'],
      summary: 'ブログ記事の更新・公開・非公開に戻す',
    })
    .errors({ ...notFoundError, ...saveErrors })
    .input(idWithBody(blogPostInput))
    .output(blogPostOutput),
  remove: base
    .route({
      method: 'DELETE',
      path: '/blog-posts/{id}',
      ...byIdRoute,
      successStatus: 204,
      tags: ['blog-posts'],
      summary: 'ブログ記事の削除',
    })
    .errors(notFoundError)
    .input(idInput)
    .output(z.void()),
}

export const codingLogsContract = {
  list: base
    .route({ method: 'GET', path: '/coding-logs', tags: ['coding-logs'], summary: `コーディング記録の${listSummary}` })
    .input(z.object({ status: statusSchema.optional(), kind: codingLogKindSchema.optional() }))
    .output(z.object({ items: z.array(z.object({ ...commonListItemFields, kind: codingLogKindSchema })) })),
  create: base
    .route({
      method: 'POST',
      path: '/coding-logs',
      successStatus: 201,
      tags: ['coding-logs'],
      summary: 'コーディング記録の作成',
    })
    .errors(saveErrors)
    .input(codingLogInput)
    .output(codingLogOutput),
  get: base
    .route({
      method: 'GET',
      path: '/coding-logs/{id}',
      ...byIdRoute,
      tags: ['coding-logs'],
      summary: 'コーディング記録の1件',
    })
    .errors(notFoundError)
    .input(idInput)
    .output(codingLogOutput),
  update: base
    .route({
      method: 'PUT',
      path: '/coding-logs/{id}',
      ...byIdRoute,
      tags: ['coding-logs'],
      summary: 'コーディング記録の更新・公開・非公開に戻す',
    })
    .errors({ ...notFoundError, ...saveErrors })
    .input(idWithBody(codingLogInput))
    .output(codingLogOutput),
  remove: base
    .route({
      method: 'DELETE',
      path: '/coding-logs/{id}',
      ...byIdRoute,
      successStatus: 204,
      tags: ['coding-logs'],
      summary: 'コーディング記録の削除',
    })
    .errors(notFoundError)
    .input(idInput)
    .output(z.void()),
}

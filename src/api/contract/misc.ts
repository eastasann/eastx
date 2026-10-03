/**
 * スラッグ・アップロード・OpenAPI（SDD 5.10）。
 */
import { z } from 'zod'
import { base, idParam, LIMITS, slugString } from './common'

/** スラッグを持つ種類（同じ種類の中で一意） */
export const SLUG_TYPES = ['work', 'project', 'blog-post', 'coding-log'] as const
export const slugTypeSchema = z.enum(SLUG_TYPES)

export const slugsContract = {
  suggest: base
    .route({
      method: 'GET',
      path: '/slugs/suggest',
      tags: ['slugs'],
      summary: '英語のタイトルから、同じ種類の中で重複しないスラッグを作る',
    })
    .input(z.object({ type: slugTypeSchema, title: z.string().max(LIMITS.shortText), excludeId: idParam.optional() }))
    .output(z.object({ slug: z.string().nullable() })),
  availability: base
    .route({ method: 'GET', path: '/slugs/availability', tags: ['slugs'], summary: 'スラッグが使えるか' })
    .input(z.object({ type: slugTypeSchema, slug: slugString, excludeId: idParam.optional() }))
    .output(z.object({ available: z.boolean() })),
}

/** アップロードの上限（SDD 5.10） */
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024

export const UPLOAD_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/svg+xml',
] as const
export type UploadContentType = (typeof UPLOAD_CONTENT_TYPES)[number]

/** design-spec 6.7.3 の文言 */
export const UPLOAD_MESSAGES = {
  notImage: '画像ファイルではありません',
  tooLarge: 'ファイルが大きすぎます（上限 5MB）',
} as const

export const uploadsContract = {
  create: base
    .route({
      method: 'POST',
      path: '/uploads',
      successStatus: 201,
      tags: ['uploads'],
      summary: '画像のアップロード（multipart/form-data の file。R2 へ）',
    })
    .input(
      z.object({
        file: z.file(UPLOAD_MESSAGES.notImage).max(UPLOAD_MAX_BYTES, UPLOAD_MESSAGES.tooLarge),
      }),
    )
    .output(
      z.object({
        url: z.string(),
        contentType: z.enum(UPLOAD_CONTENT_TYPES),
        size: z.number().int(),
      }),
    ),
}

export const openapiContract = {
  get: base
    .route({ method: 'GET', path: '/openapi.json', tags: ['openapi'], summary: 'この API の OpenAPI 3.1 の仕様' })
    .output(z.record(z.string(), z.unknown())),
}

import { z } from 'zod'
import {
  base,
  byIdRoute,
  idInput,
  idWithBody,
  isoDateTime,
  LIMITS,
  notFoundError,
  optionalHttpsUrl,
  optionalMediaUrl,
  optionalSlug,
  orderOutOfDateError,
  reorderInput,
  slugString,
  stackKeyConflictError,
} from './common'

const displayName = z.string().trim().min(1, '表示名を入力してください').max(LIMITS.shortText)

/** A7 の新規作成と、A5・A6 の「新しい技術として追加」（表示名だけ）の両方を受ける（SDD 5.8） */
export const stackCreateInput = z.object({
  /** 省くと表示名から作る（design-spec 6.7.1） */
  key: optionalSlug,
  displayName,
  iconUrl: optionalMediaUrl,
  linkUrl: optionalHttpsUrl,
  showOnTop: z.boolean().default(true),
})

export const stackUpdateInput = z.object({
  key: slugString,
  displayName,
  iconUrl: optionalMediaUrl,
  linkUrl: optionalHttpsUrl,
  showOnTop: z.boolean(),
})

const listItemFields = {
  id: z.string(),
  key: z.string(),
  displayName: z.string(),
  iconUrl: z.string().nullable(),
  linkUrl: z.string().nullable(),
  showOnTop: z.boolean(),
  sortOrder: z.number().int(),
  /** 使っている作品とプロジェクトの数の合計 */
  usageCount: z.number().int(),
}

export const stackOutput = z.object({ ...listItemFields, createdAt: isoDateTime, updatedAt: isoDateTime })

const tags = ['stacks']

export const stacksContract = {
  list: base
    .route({ method: 'GET', path: '/stacks', tags, summary: '使用技術の一覧（表示順）' })
    .output(z.object({ items: z.array(z.object(listItemFields)) })),
  create: base
    .route({ method: 'POST', path: '/stacks', successStatus: 201, tags, summary: '使用技術の作成（末尾に入る）' })
    .errors(stackKeyConflictError)
    .input(stackCreateInput)
    .output(stackOutput),
  get: base
    .route({ method: 'GET', path: '/stacks/{id}', ...byIdRoute, tags, summary: '使用技術の1件' })
    .errors(notFoundError)
    .input(idInput)
    .output(stackOutput),
  update: base
    .route({ method: 'PUT', path: '/stacks/{id}', ...byIdRoute, tags, summary: '使用技術の更新' })
    .errors({ ...notFoundError, ...stackKeyConflictError })
    .input(idWithBody(stackUpdateInput))
    .output(stackOutput),
  remove: base
    .route({
      method: 'DELETE',
      path: '/stacks/{id}',
      ...byIdRoute,
      successStatus: 204,
      tags,
      summary: '使用技術の削除（紐づけも外れる）',
    })
    .errors(notFoundError)
    .input(idInput)
    .output(z.void()),
  reorder: base
    .route({ method: 'POST', path: '/stacks/reorder', tags, summary: '使用技術の表示順' })
    .errors(orderOutOfDateError)
    .input(reorderInput)
    .output(reorderInput),
}

import { z } from 'zod'
import { base, isoDateTime } from './common'

const statusCounts = z.object({ published: z.number().int(), draft: z.number().int() })

export const draftTypeSchema = z.enum(['career', 'project', 'work', 'blog-post', 'coding-log'])

export const dashboardOutput = z.object({
  counts: z.object({
    careers: statusCounts,
    projects: statusCounts,
    works: statusCounts,
    stacks: z.object({ total: z.number().int() }),
    blogPosts: statusCounts,
    codingLogs: statusCounts,
  }),
  drafts: z.object({
    items: z.array(
      z.object({
        type: draftTypeSchema,
        id: z.string(),
        title: z.object({ ja: z.string().nullable(), en: z.string().nullable() }),
        updatedAt: isoDateTime,
      }),
    ),
    total: z.number().int(),
  }),
})

export const dashboardContract = {
  get: base
    .route({ method: 'GET', path: '/dashboard', tags: ['dashboard'], summary: 'A2 の件数と下書きの一覧' })
    .output(dashboardOutput),
}

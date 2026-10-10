import { z } from 'zod'
import {
  EXPANDABLE_SECTIONS,
  LINK_KINDS,
  PAGED_SECTIONS,
  THEME_CHOICES,
  TOP_SECTIONS,
} from '../../domain/analytics/events'
import { ANALYTICS_RANGES, BUCKETS } from '../../domain/analytics/report'
import { base } from './common'

/** 日本時間の日（SDD 5.0） */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const nullableTitle = z.object({ ja: z.string().nullable(), en: z.string().nullable() }).nullable()
const keyCount = z.object({ key: z.string(), count: z.number().int(), visitors: z.number().int() })
const totals = z.object({ pageViews: z.number().int(), visitors: z.number().int(), outbound: z.number().int() })
const countsOf = <T extends readonly [string, ...string[]]>(keys: T) =>
  z.object(Object.fromEntries(keys.map((key) => [key, z.number().int()])) as Record<T[number], z.ZodNumber>)

export const analyticsRangeSchema = z.enum(ANALYTICS_RANGES)

export const analyticsOutput = z.object({
  measuring: z.boolean(),
  range: analyticsRangeSchema,
  from: isoDate,
  to: isoDate,
  today: z.object({ included: z.boolean() }),
  missingDays: z.number().int(),
  totals: totals.extend({ previous: totals.nullable() }),
  series: z.object({
    bucket: z.enum(BUCKETS),
    points: z.array(z.object({ start: isoDate, pageViews: z.number().int(), visitors: z.number().int() })),
  }),
  pages: z.array(
    z.object({ path: z.string(), title: nullableTitle, pageViews: z.number().int(), visitors: z.number().int() }),
  ),
  referrers: z.array(keyCount),
  utm: z.array(keyCount),
  sectionReach: z.array(
    z.object({ section: z.enum(TOP_SECTIONS), visitors: z.number().int(), rate: z.number().nullable() }),
  ),
  rowExpands: z.array(
    z.object({
      section: z.enum(EXPANDABLE_SECTIONS),
      itemId: z.string(),
      title: nullableTitle,
      count: z.number().int(),
      visitors: z.number().int(),
    }),
  ),
  outbounds: z.array(
    z.object({ linkKind: z.enum(LINK_KINDS), host: z.string(), count: z.number().int(), visitors: z.number().int() }),
  ),
  readCompletes: z.array(
    z.object({ path: z.string(), title: nullableTitle, count: z.number().int(), visitors: z.number().int() }),
  ),
  otherActions: z.object({
    langSwitch: countsOf(['ja', 'en'] as const),
    themeSwitch: countsOf(THEME_CHOICES),
    codeCopy: z.number().int(),
    paging: countsOf(PAGED_SECTIONS),
  }),
  audience: z.object({
    countries: z.array(keyCount),
    devices: z.array(keyCount),
    browserLangs: z.array(keyCount),
    siteLangs: z.array(keyCount),
  }),
})

export const analyticsContract = {
  get: base
    .route({ method: 'GET', path: '/analytics', tags: ['analytics'], summary: 'A10 のアクセス解析' })
    .input(z.object({ range: analyticsRangeSchema }))
    .output(analyticsOutput),
}

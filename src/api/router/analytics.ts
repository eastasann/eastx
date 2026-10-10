import { env } from 'cloudflare:workers'
import { isMeasuring, loadAnalyticsReport } from '../analytics/report'
import { sqlApiConfigOf } from '../analytics/sql'
import { admin, db } from './base'

export const analytics = {
  get: admin.analytics.get.handler(({ input, context }) =>
    loadAnalyticsReport({
      db: db(),
      range: input.range,
      now: Date.now(),
      config: sqlApiConfigOf(env),
      measuring: isMeasuring(env),
      requestId: context.requestId,
    }),
  ),
}

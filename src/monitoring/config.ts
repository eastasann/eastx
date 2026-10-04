/**
 * ブラウザのエラー追跡の設定を、ルートのローダーへ渡すサーバー関数（SDD 11章）。
 * DSN はビルド時の環境変数にせず、環境ごとの Worker の `SENTRY_DSN` から渡す
 */
import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import type { BrowserMonitoringConfig } from './browser'

export const getBrowserMonitoringConfig = createServerFn({ method: 'GET' }).handler(
  (): BrowserMonitoringConfig => ({ dsn: env.SENTRY_DSN, environment: env.ENVIRONMENT }),
)

/**
 * ブラウザのエラー追跡とパフォーマンス計測（SDD 7章・11章）。Sentry の SDK は DSN があるときだけ読み込み、
 * DSN のない環境（ローカル・CI）と、公開側の最初の表示のバンドルには入れない。
 * Web Vitals（TTFB・LCP）は browserTracingIntegration のページ読み込みの計測が送る
 */
import { useEffect } from 'react'
import { tracesSampleRate } from './sampling'

export interface BrowserMonitoringConfig {
  /** 空なら送らない */
  dsn: string
  environment: string
}

type SentryModule = typeof import('@sentry/react')

/**
 * エラー境界は子から先に描画を終えるので、ルートが初期化する前に例外を受けることがある。
 * 初期化までに受けた例外は溜めておき、DSN があれば初期化のあとに送り、なければ捨てる
 */
type State =
  | { kind: 'waiting'; pending: unknown[] }
  | { kind: 'off' }
  /** SDK の読み込みに失敗したら null（送れないエラーのために画面を壊さない） */
  | { kind: 'on'; sentry: Promise<SentryModule | null> }

let state: State = { kind: 'waiting', pending: [] }

export function initBrowserMonitoring(config: BrowserMonitoringConfig): void {
  if (state.kind !== 'waiting') return
  const { pending } = state
  if (config.dsn === '') {
    state = { kind: 'off' }
    return
  }
  const sentry = import('@sentry/react').then(
    (Sentry) => {
      Sentry.init({
        dsn: config.dsn,
        environment: config.environment,
        integrations: [Sentry.browserTracingIntegration()],
        tracesSampleRate: tracesSampleRate(config.environment),
      })
      for (const error of pending) Sentry.captureException(error)
      return Sentry
    },
    (error: unknown) => {
      // 送り先がないので、読み込めなかったことだけを開発者ツールに残す
      console.error('Sentry の SDK を読み込めませんでした', error)
      return null
    },
  )
  state = { kind: 'on', sentry }
}

/**
 * サーバーが送ったうえで中身を伏せた例外（公開側のサーバー関数の失敗。src/content/server-fns.ts）は
 * サーバーの Issue と同じものなので送らない
 */
function isReportedByServer(error: unknown): boolean {
  return error instanceof Error && error.message === 'INTERNAL_SERVER_ERROR'
}

export function reportBrowserError(error: unknown): void {
  if (isReportedByServer(error)) return
  if (state.kind === 'waiting') state.pending.push(error)
  else if (state.kind === 'on') void state.sentry.then((Sentry) => Sentry?.captureException(error))
}

/** エラー境界（ルートの errorComponent）で受けた例外を送る */
export function useReportBrowserError(error: unknown): void {
  useEffect(() => {
    reportBrowserError(error)
  }, [error])
}

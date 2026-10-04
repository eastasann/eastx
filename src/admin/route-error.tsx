/**
 * 管理画面の想定外のエラー（描画・ローダーの例外）の表示（SDD 8章「フロントエンドでの表示方針」）。
 * 通信・サーバーエラーと同じ「読み込めませんでした」と「再試行」で、詳細はローカル（ENVIRONMENT=local）だけ出す
 */
import { type ErrorComponentProps, getRouteApi, useRouter } from '@tanstack/react-router'
import { css } from 'styled-system/css'
import { LoadError } from './states'

const rootRoute = getRouteApi('__root__')

export function AdminRouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter()
  // ルートのローダー自身が失敗したときは設定がないので、詳細は出さない
  const environment = rootRoute.useLoaderData()?.environment
  return (
    <div className={css({ display: 'flex', flexDirection: 'column', gap: 'stack' })}>
      <LoadError
        onRetry={() => {
          reset()
          void router.invalidate()
        }}
      />
      {environment === 'local' && (
        <pre
          className={css({
            textStyle: 'code',
            color: 'text.muted',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          })}
        >
          {error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error)}
        </pre>
      )}
    </div>
  )
}

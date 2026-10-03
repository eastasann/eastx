import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { css } from 'styled-system/css'
import { isLang, type Lang } from '~/i18n/detect'

// P1 トップの中身は Step 6（getTopPage）。ここでは SSR とサーバー関数の経路を通すだけ。
// サーバー関数は誰でも呼べる HTTP エンドポイントになるので、入力は必ず検証する（SDD 7章）。
// 公開側のバンドルに Zod を入れない方針のため、検証は素の関数で書く（ADR-008）
const getSiteHeading = createServerFn({ method: 'GET' })
  .validator((input: unknown): Lang => {
    if (typeof input !== 'string' || !isLang(input)) throw new Error('lang は ja か en')
    return input
  })
  .handler(() => ({ siteName: 'eastasian' }))

export const Route = createFileRoute('/$lang/')({
  loader: ({ params }) => getSiteHeading({ data: params.lang }),
  component: TopPage,
})

function TopPage() {
  const { siteName } = Route.useLoaderData()
  return (
    <main className={css({ p: 'section' })}>
      <h1 className={css({ textStyle: 'display' })}>{siteName}</h1>
    </main>
  )
}

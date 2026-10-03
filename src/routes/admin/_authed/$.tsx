import { createFileRoute, redirect } from '@tanstack/react-router'
import { NOTICES } from '~/admin/labels'
import { toaster } from '~/ui/toast'

// 管理画面のどのルートにも当たらないパスは A2 へ移し、「ページが見つかりませんでした」と通知する（design-spec 6.6）。
// パスのないレイアウトは子が当たらないと一致しないので、スプラットで受けてレイアウトのセッションの確認を通す
// （ログインしていなければ、ここに来る前にレイアウトが A1 へ移す）。
// notFoundComponent の中で <Navigate> を描くと、描画のたびに移動をかけ続けて止まらなくなる
export const Route = createFileRoute('/admin/_authed/$')({
  beforeLoad: ({ preload }) => {
    // リンクにポインターを重ねたときの先読み（defaultPreload: 'intent'）では、移っていないので通知しない
    if (!preload) toaster.create({ title: NOTICES.pageNotFound, type: 'warning' })
    throw redirect({ to: '/admin', replace: true })
  },
})

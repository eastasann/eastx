import { createFileRoute, redirect } from '@tanstack/react-router'
import { reportBrowserError } from '~/monitoring/browser'

// 管理画面のどのルートにも当たらないパスは A2 へ移し、「ページが見つかりませんでした」と通知する（design-spec 6.6）。
// パスのないレイアウトは子が当たらないと一致しないので、スプラットで受けてレイアウトのセッションの確認を通す
// （ログインしていなければ、ここに来る前にレイアウトが A1 へ移す）。
// notFoundComponent の中で <Navigate> を描くと、描画のたびに移動をかけ続けて止まらなくなる
export const Route = createFileRoute('/admin/_authed/$')({
  beforeLoad: async ({ preload }) => {
    // リンクにポインターを重ねたときの先読み（defaultPreload: 'intent'）では、移っていないので通知しない。
    // ルートの設定（beforeLoad）は公開側と同じバンドルに入るので、トーストと文言はここで読み込む（SDD 7章）
    // 読み込めなくて（デプロイで古いチャンクが消えたなど）通知を出せなくても、A2 へは移す
    if (!preload) {
      await Promise.all([import('~/ui/toast'), import('~/admin/labels')]).then(
        ([{ toaster }, { NOTICES }]) => toaster.create({ title: NOTICES.pageNotFound, type: 'warning' }),
        reportBrowserError,
      )
    }
    throw redirect({ to: '/admin', replace: true })
  },
})

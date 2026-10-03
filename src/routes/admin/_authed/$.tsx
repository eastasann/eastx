import { createFileRoute, redirect } from '@tanstack/react-router'

// 管理画面のどのルートにも当たらないパスは A2 へ（design-spec 6.6。通知のトーストは Step 7）。
// パスのないレイアウトは子が当たらないと一致しないので、スプラットで受けてレイアウトのセッションの確認を通す。
// notFoundComponent の中で <Navigate> を描くと、描画のたびに移動をかけ続けて止まらなくなる
export const Route = createFileRoute('/admin/_authed/$')({
  beforeLoad: () => {
    throw redirect({ to: '/admin', replace: true })
  },
})

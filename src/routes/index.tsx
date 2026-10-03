import { createFileRoute } from '@tanstack/react-router'
import { detectLang } from '~/i18n/detect'

// ルート `/` は画面を持たず、design-spec 1.4 の振り分けで /ja か /en へ 302 する（SDD 9章）
export const Route = createFileRoute('/')({
  server: {
    handlers: {
      GET: ({ request }) => {
        const lang = detectLang(request.headers.get('cookie'), request.headers.get('accept-language'))
        return new Response(null, { status: 302, headers: { Location: `/${lang}` } })
      },
    },
  },
})

/**
 * 管理画面の中のリンク。行き先をパスの文字列で受け、普通のクリックはルーターで移る（ページを読み込み直さない）。
 * 型付きの Link を使わないのは、行き先がルートの型に縛られない場所（サイドメニュー・ダッシュボードの近道と下書き）で
 * 種類ごとの行き先を表から引くため
 */
import { useRouter } from '@tanstack/react-router'
import type { ComponentProps, MouseEvent } from 'react'
import { isPlainClick } from '~/ui/navigation'

export interface AdminLinkProps extends ComponentProps<'a'> {
  href: string
  /** ルーターで移る前に呼ぶ（引き出しのメニューを閉じる） */
  onNavigate?: () => void
}

// 残りの props と ref は <a> にそのまま渡す。ツールチップの Trigger（asChild）がイベントと ref を足すため
export function AdminLink({ href, onNavigate, onClick, ...rest }: AdminLinkProps) {
  const router = useRouter()

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event)
    if (event.defaultPrevented || !isPlainClick(event)) return
    event.preventDefault()
    onNavigate?.()
    void router.navigate({ href })
  }

  return <a href={href} onClick={handleClick} {...rest} />
}

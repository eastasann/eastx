/**
 * 管理画面の読み込み中・取得に失敗の表示（design-spec 6.5〜6.7.4）
 */
import { css, cx } from 'styled-system/css'
import { button } from '~/ui/recipes'
import { NOTICES } from './labels'

/** 読み込み中の形だけの枠。動きは付けない（design-spec 4.4 の「動き」） */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(css({ display: 'block', h: 'icon', bg: 'bg.muted', borderRadius: 'control' }), className)}
    />
  )
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className={css({ display: 'flex', alignItems: 'center', gap: 'inline', py: 'inset' })}>
      <p className={css({ textStyle: 'body-sm', color: 'danger.default' })}>{NOTICES.loadFailed}</p>
      <button type="button" onClick={onRetry} className={button({ variant: 'outline' })}>
        再試行
      </button>
    </div>
  )
}

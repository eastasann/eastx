/**
 * 確認ダイアログ（design-spec 6.6・6.7.1: 削除・非公開に戻す・保存していない変更・公開済みのスラッグの変更）
 */
import { css } from 'styled-system/css'
import { Dialog } from '~/ui/dialog'
import { button } from '~/ui/recipes'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  /** 元に戻せない操作（削除）は危険の色にする */
  danger?: boolean
  /** 実行中は両方のボタンを止める */
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger = false,
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onCancel()
      }}
      title={title}
      description={message}
      closeLabel="閉じる"
    >
      <div className={css({ display: 'flex', justifyContent: 'flex-end', gap: 'inline' })}>
        <button type="button" onClick={onCancel} disabled={pending} className={button({ variant: 'outline' })}>
          キャンセル
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          aria-busy={pending}
          className={button({ variant: danger ? 'danger' : 'solid' })}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  )
}

import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import { Button } from './primitives'

/**
 * Confirm primitive for destructive + live re-init actions (UI-SPEC should-fix).
 *
 * Built on the native `<dialog>` element, which gives a real focus trap and Esc
 * cancellation for free (`showModal`). `onCancel` fires on Esc or backdrop-close
 * so a destructive action can never be bypassed silently.
 */
export interface ConfirmDialogProps {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps): ReactElement {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="og-dialog"
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
    >
      <h2 className="og-dialog__title">{title}</h2>
      <p className="og-dialog__body">{body}</p>
      <div className="og-dialog__actions">
        <Button variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button variant={destructive ? 'destructive' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  )
}

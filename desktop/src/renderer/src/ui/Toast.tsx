import type { ReactElement } from 'react'

/**
 * Polite toast (UI-SPEC: toasts use `role="status"`; chord-blocked / re-init /
 * launch notices). Motion is suppressed under `prefers-reduced-motion` in CSS.
 */
export interface ToastProps {
  message: string | null
}

export function Toast({ message }: ToastProps): ReactElement | null {
  if (!message) return null
  return (
    <div className="og-toast" role="status">
      {message}
    </div>
  )
}

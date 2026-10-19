import { useEffect } from 'react'
import type { ReactNode } from 'react'

/** Shared small UI primitives used by the product/inventory screens. */

export function Alert({ kind, children }: { kind: 'error' | 'success'; children: ReactNode }): React.JSX.Element | null {
  if (!children) return null
  return <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>
}

export function Field({
  label,
  htmlFor,
  required,
  hint,
  children
}: {
  label: string
  htmlFor: string
  required?: boolean
  hint?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>
        {label}
        {required ? <span className="req"> *</span> : <span className="opt"> (اختياري)</span>}
      </label>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children
}: {
  title: string
  onClose: () => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="إغلاق">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  OPENING: 'رصيد افتتاحي',
  RECEIPT: 'استلام دفعة',
  CORRECTION_UP: 'تصحيح بالزيادة',
  CORRECTION_DOWN: 'تصحيح بالعجز'
}

/** Accessible in-app confirmation dialog (replaces window.confirm). */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'تأكيد',
  cancelLabel = 'إلغاء',
  onConfirm,
  onCancel
}: {
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal card"
        dir="rtl"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>{title}</h3>
        </div>
        <p className="confirm-box">{message}</p>
        <div className="form-actions">
          <button type="button" className="btn btn-primary" autoFocus onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Formats SQLite `datetime('now')` (UTC) as local Arabic date/time. */
export function formatDateTime(utc: string): string {
  const d = new Date(utc.includes('T') ? utc : utc.replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return utc
  return new Intl.DateTimeFormat('ar-DZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    numberingSystem: 'latn'
  }).format(d)
}

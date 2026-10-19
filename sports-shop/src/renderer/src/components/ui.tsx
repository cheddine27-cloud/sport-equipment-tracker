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

import { useState } from 'react'
import type { Product } from '../../../shared/types'
import { unwrap } from '../lib/db-client'
import { Alert, Field } from '../components/ui'

/**
 * Receive-batch and stock-correction dialogs. Both are destructive-ish stock
 * operations, so each requires an explicit confirmation step before the IPC
 * call is made. The correction reason is mandatory (also enforced in main).
 */

interface DialogProps {
  product: Product
  onDone: () => void
  onClose: () => void
}

export function ReceiveStockDialog({ product, onDone, onClose }: DialogProps): React.JSX.Element {
  const [quantity, setQuantity] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const q = Number(quantity)
  const valid = quantity.trim() !== '' && Number.isInteger(q) && q > 0

  async function submit(): Promise<void> {
    if (!valid) {
      setError('أدخل كمية صحيحة: عدد صحيح أكبر من صفر.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await unwrap(window.desktop.stock.receive({ productId: product.id, quantity: q, reason: note.trim() || null }))
      onDone()
    } catch (e) {
      setError((e as Error).message)
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="dialog-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!confirming) {
          if (!valid) {
            setError('أدخل كمية صحيحة: عدد صحيح أكبر من صفر.')
            return
          }
          setConfirming(true)
        } else {
          void submit()
        }
      }}
    >
      <p className="muted">
        المنتج: <strong>{product.name}</strong> ({product.code}) — الكمية الحالية: <strong>{product.quantity}</strong>
      </p>
      <Alert kind="error">{error}</Alert>
      <Field label="كمية الدفعة المستلمة" htmlFor="rs-qty" required>
        <input id="rs-qty" type="number" min={1} step={1} dir="ltr" className="num" value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus />
      </Field>
      <Field label="ملاحظة (اختياري)" htmlFor="rs-note">
        <input id="rs-note" type="text" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: دفعة من المورد — رقم الفاتورة الورقية" />
      </Field>
      {confirming && (
        <div className="confirm-box" role="alert">
          هل تؤكد استلام <strong>{q}</strong> وحدة وإضافتها إلى المخزون ليصبح الرصيد <strong>{product.quantity + (Number.isInteger(q) && q > 0 ? q : 0)}</strong>؟
        </div>
      )}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'جارٍ التسجيل…' : confirming ? 'تأكيد الاستلام' : 'متابعة'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
          إلغاء
        </button>
      </div>
    </form>
  )
}

export function CorrectStockDialog({ product, onDone, onClose }: DialogProps): React.JSX.Element {
  const [newQuantity, setNewQuantity] = useState(String(product.quantity))
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const n = Number(newQuantity)
  const validQty = newQuantity.trim() !== '' && Number.isInteger(n) && n >= 0
  const validReason = reason.trim().length >= 3
  const delta = validQty ? n - product.quantity : 0

  async function submit(): Promise<void> {
    if (!validQty) {
      setError('الكمية الجديدة يجب أن تكون عدداً صحيحاً ≥ ٠.')
      return
    }
    if (!validReason) {
      setError('سبب التصحيح إلزامي (٣ أحرف على الأقل).')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await unwrap(
        window.desktop.stock.correct({ productId: product.id, newQuantity: n, reason: reason.trim() })
      )
      onDone()
    } catch (e) {
      setError((e as Error).message)
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="dialog-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!confirming) {
          if (!validQty) {
            setError('الكمية الجديدة يجب أن تكون عدداً صحيحاً ≥ ٠.')
            return
          }
          if (!validReason) {
            setError('سبب التصحيح إلزامي (٣ أحرف على الأقل).')
            return
          }
          setConfirming(true)
        } else {
          void submit()
        }
      }}
    >
      <p className="muted">
        المنتج: <strong>{product.name}</strong> ({product.code}) — الكمية الحالية: <strong>{product.quantity}</strong>
      </p>
      <Alert kind="error">{error}</Alert>
      <Field label="الكمية الفعلية بعد الجرد" htmlFor="cs-qty" required hint="تُسجَّل الحركة كتصحيح بالزيادة أو بالعجز مع الفرق المحسوب تلقائياً">
        <input id="cs-qty" type="number" min={0} step={1} dir="ltr" className="num" value={newQuantity} onChange={(e) => setNewQuantity(e.target.value)} autoFocus />
      </Field>
      <Field label="سبب التصحيح" htmlFor="cs-reason" required>
        <textarea
          id="cs-reason"
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="مثال: جرد دوري — ضبط عجز بعد التحقق من الكاميرات"
        />
      </Field>
      {confirming && (
        <div className="confirm-box" role="alert">
          هل تؤكد تعديل رصيد «{product.name}» من <strong>{product.quantity}</strong> إلى <strong>{n}</strong> (فرق{' '}
          {delta > 0 ? `+${delta}` : delta})؟ هذا الإجراء يُسجَّل في تاريخ الحركات ولا يمكن حذفه.
        </div>
      )}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'جارٍ التسجيل…' : confirming ? 'تأكيد التصحيح' : 'متابعة'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
          إلغاء
        </button>
      </div>
    </form>
  )
}

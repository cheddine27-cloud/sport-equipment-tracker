import { useState } from 'react'
import type { Category, Product } from '../../../shared/types'
import { Field, Alert } from '../components/ui'
import {
  emptyProductForm,
  productFormToCreateInput,
  productFormToErrors,
  productFormToUpdateInput,
  type ProductFormValues
} from '../lib/validate'

interface ProductFormProps {
  categories: Category[]
  /** When provided the form edits an existing product. */
  initial?: Product
  saving: boolean
  serverError: string | null
  onSave: (
    input: ReturnType<typeof productFormToCreateInput> | ReturnType<typeof productFormToUpdateInput>
  ) => void
  onCancel: () => void
}

function toFormValues(p: Product): ProductFormValues {
  return {
    code: p.code,
    name: p.name,
    categoryId: String(p.categoryId),
    size: p.size ?? '',
    color: p.color ?? '',
    material: p.material ?? '',
    purchasePrice: String(p.purchasePrice),
    salePrice: String(p.salePrice),
    externalPrice: String(p.externalPrice),
    openingQuantity: String(p.quantity),
    minStock: String(p.minStock),
    supplierRef: p.supplierRef ?? ''
  }
}

/** Shared add/edit product form (Arabic, RTL). Stock quantity is read-only in edit mode by design. */
function ProductForm({
  categories,
  initial,
  saving,
  serverError,
  onSave,
  onCancel
}: ProductFormProps): React.JSX.Element {
  const isEdit = !!initial
  const [v, setV] = useState<ProductFormValues>(initial ? toFormValues(initial) : emptyProductForm)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const set =
    (key: keyof ProductFormValues) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setV((old) => ({ ...old, [key]: e.target.value }))

  function submit(e: React.FormEvent): void {
    e.preventDefault()
    const errs = productFormToErrors(v, isEdit)
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    onSave(
      isEdit && initial
        ? productFormToUpdateInput(v, initial.id, initial.active)
        : productFormToCreateInput(v)
    )
  }

  const num = (
    key: keyof ProductFormValues,
    label: string,
    required = true,
    disabled = false,
    hint?: string
  ): React.JSX.Element => (
    <Field label={label} htmlFor={`f-${key}`} required={required} hint={hint}>
      <input
        id={`f-${key}`}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={v[key]}
        onChange={set(key)}
        disabled={disabled}
        dir="ltr"
        className="num"
      />
    </Field>
  )

  const txt = (
    key: keyof ProductFormValues,
    label: string,
    required = false,
    placeholder = ''
  ): React.JSX.Element => (
    <Field label={label} htmlFor={`f-${key}`} required={required}>
      <input
        id={`f-${key}`}
        type="text"
        value={v[key]}
        onChange={set(key)}
        placeholder={placeholder}
        maxLength={200}
      />
    </Field>
  )

  return (
    <form className="form-grid" onSubmit={submit} noValidate>
      <Alert kind="error">{serverError}</Alert>

      <div className="form-section-title">التعريف</div>
      {txt('code', 'رمز المنتج (SKU)', true, 'مثال: CFG-001')}
      {txt('name', 'اسم المنتج', true)}
      <Field label="الفئة" htmlFor="f-categoryId" required>
        <select id="f-categoryId" value={v.categoryId} onChange={set('categoryId')}>
          <option value="">— اختر الفئة —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="form-section-title">الوصف</div>
      {txt('size', 'المقاس', false, 'اتركه فارغاً إن لم ينطبق')}
      {txt('color', 'اللون', false)}
      {txt('material', 'المادة / النوع', false)}
      {txt('supplierRef', 'مرجع المورد (نص حر)', false, 'سيصبح ربطاً بالمورد في مرحلة لاحقة')}

      <div className="form-section-title">الأسعار بالدينار الجزائري (دج)</div>
      {num('purchasePrice', 'سعر الشراء للوحدة')}
      {num('salePrice', 'سعر البيع داخل المحل')}
      {num('externalPrice', 'سعر البيع الخارجي / الإلكتروني')}

      <div className="form-section-title">المخزون</div>
      {isEdit
        ? num(
            'openingQuantity',
            'الكمية الحالية في المخزون',
            true,
            true,
            'تتغيّر فقط عبر استلام دفعة أو تصحيح مخزون مسجّل'
          )
        : num(
            'openingQuantity',
            'الرصيد الافتتاحي',
            true,
            false,
            'يسجَّل كحركة مخزون افتتاحية قابلة للتدقيق'
          )}
      {num('minStock', 'حد التنبيه لأدنى مخزون')}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'جارٍ الحفظ…' : isEdit ? 'حفظ التعديلات' : 'إضافة المنتج'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
          إلغاء
        </button>
      </div>

      {Object.keys(errors).length > 0 && (
        <ul className="error-list" role="alert">
          {Object.entries(errors).map(([k, msg]) => (
            <li key={k}>{msg}</li>
          ))}
        </ul>
      )}
    </form>
  )
}

export default ProductForm

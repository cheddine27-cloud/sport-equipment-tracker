import type { ProductInput, ProductUpdate } from '../../../shared/types'

/**
 * Renderer-side form validation. These checks only improve UX — the SAME
 * rules are enforced authoritatively in the main process before any SQL runs.
 */

export interface ProductFormValues {
  code: string
  name: string
  categoryId: string
  size: string
  color: string
  material: string
  purchasePrice: string
  salePrice: string
  externalPrice: string
  openingQuantity: string
  minStock: string
  supplierRef: string
}

export const emptyProductForm: ProductFormValues = {
  code: '',
  name: '',
  categoryId: '',
  size: '',
  color: '',
  material: '',
  purchasePrice: '',
  salePrice: '',
  externalPrice: '',
  openingQuantity: '0',
  minStock: '0',
  supplierRef: ''
}

export function productFormToErrors(v: ProductFormValues, isEdit: boolean): Record<string, string> {
  const e: Record<string, string> = {}
  if (!v.code.trim()) e.code = 'رمز المنتج (SKU) مطلوب'
  if (!v.name.trim()) e.name = 'اسم المنتج مطلوب'
  if (!v.categoryId) e.categoryId = 'يجب اختيار الفئة'
  const prices: Array<[keyof ProductFormValues, string]> = [
    ['purchasePrice', 'سعر الشراء'],
    ['salePrice', 'سعر البيع'],
    ['externalPrice', 'سعر البيع الخارجي']
  ]
  for (const [key, label] of prices) {
    const n = Number(v[key])
    if (v[key].trim() === '' || !Number.isInteger(n) || n < 0) {
      e[key] = `${label}: عدد صحيح بالدينار ≥ ٠ مطلوب`
    }
  }
  const checkInt = (key: keyof ProductFormValues, label: string, allowZero: boolean): void => {
    const n = Number(v[key])
    const raw = v[key].trim()
    if (raw === '' || !Number.isInteger(n) || n < (allowZero ? 0 : 1)) {
      e[key] = `${label}: ${allowZero ? 'عدد صحيح ≥ ٠' : 'عدد صحيح موجب'} مطلوب`
    }
  }
  if (!isEdit) checkInt('openingQuantity', 'الرصيد الافتتاحي', true)
  checkInt('minStock', 'حد التنبيه', true)
  return e
}

export function productFormToCreateInput(v: ProductFormValues): ProductInput {
  return {
    code: v.code.trim(),
    name: v.name.trim(),
    categoryId: Number(v.categoryId),
    size: v.size.trim() || null,
    color: v.color.trim() || null,
    material: v.material.trim() || null,
    purchasePrice: Number(v.purchasePrice),
    salePrice: Number(v.salePrice),
    externalPrice: Number(v.externalPrice),
    openingQuantity: Number(v.openingQuantity),
    minStock: Number(v.minStock),
    supplierRef: v.supplierRef.trim() || null
  }
}

export function productFormToUpdateInput(
  v: ProductFormValues,
  id: number,
  active: boolean
): ProductUpdate {
  const input = productFormToCreateInput(v)
  const { openingQuantity: _drop, ...rest } = input
  return { ...rest, id, active }
}

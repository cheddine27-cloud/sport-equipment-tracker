/** Supplier purchases: goods received into stock inside one transaction. */
import type Database from 'better-sqlite3'
import { AppError, type Purchase, type PurchaseInput, type PurchaseItem, type SupplierPayment } from '../../shared/types'
import { nonNegativeInt, optionalText, positiveInt } from './validation'
import { recordMovementV2 } from './movements'
import { logAudit } from './audit'

interface PurchaseRow {
  id: number; receipt_no: string; supplier_id: number | null; supplier_name: string
  total: number; paid: number; note: string | null; created_at: string
}

function nextReceiptNo(db: Database.Database): string {
  db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('purchase_counter', '0')`).run()
  const cur = Number((db.prepare(`SELECT value FROM settings WHERE key = 'purchase_counter'`).get() as { value: string }).value) + 1
  db.prepare(`UPDATE settings SET value = ? WHERE key = 'purchase_counter'`).run(String(cur))
  return `PO-${String(cur).padStart(6, '0')}`
}

export function getPurchase(db: Database.Database, id: number): Purchase | null {
  const row = db.prepare('SELECT * FROM purchases WHERE id = ?').get(id) as PurchaseRow | undefined
  if (!row) return null
  const items = db
    .prepare(`SELECT pi.id, pi.purchase_id, pi.product_id, p.code AS product_code, p.name AS product_name,
              pi.quantity, pi.unit_cost FROM purchase_items pi JOIN products p ON p.id = pi.product_id
              WHERE pi.purchase_id = ? ORDER BY pi.id`)
    .all(id) as Array<{ id: number; purchase_id: number; product_id: number; product_code: string; product_name: string; quantity: number; unit_cost: number }>
  const mappedItems: PurchaseItem[] = items.map((i) => ({
    id: i.id, purchaseId: i.purchase_id, productId: i.product_id, productCode: i.product_code,
    productName: i.product_name, quantity: i.quantity, unitCost: i.unit_cost
  }))
  return {
    id: row.id, receiptNo: row.receipt_no, supplierId: row.supplier_id, supplierName: row.supplier_name,
    total: row.total, paid: row.paid, note: row.note, createdAt: row.created_at, items: mappedItems
  }
}

export function listPurchases(db: Database.Database, limit = 100): Purchase[] {
  const rows = db.prepare('SELECT * FROM purchases ORDER BY id DESC LIMIT ?').all(limit) as PurchaseRow[]
  return rows.map((r) => ({
    id: r.id, receiptNo: r.receipt_no, supplierId: r.supplier_id, supplierName: r.supplier_name,
    total: r.total, paid: r.paid, note: r.note, createdAt: r.created_at, items: []
  }))
}

export function createPurchase(db: Database.Database, input: PurchaseInput): Purchase {
  const linesRaw = Array.isArray(input.lines) ? input.lines : []
  if (linesRaw.length === 0) throw new AppError('VALIDATION', 'لا توجد أصناف في عملية الشراء')
  if (linesRaw.length > 200) throw new AppError('VALIDATION', 'عدد الأصناف كبير جداً')
  const lines = linesRaw.map((l, i) => ({
    productId: nonNegativeInt(l.productId, `سطر ${i + 1}: المنتج`),
    quantity: positiveInt(l.quantity, `سطر ${i + 1}: الكمية`),
    unitCost: nonNegativeInt(l.unitCost, `سطر ${i + 1}: سعر التكلفة`)
  }))
  const merged = new Map<number, { quantity: number; unitCost: number }>()
  for (const l of lines) {
    const prev = merged.get(l.productId)
    merged.set(l.productId, { quantity: (prev?.quantity ?? 0) + l.quantity, unitCost: l.unitCost })
  }
  const paid = nonNegativeInt(input.paid, 'المبلغ المدفوع للمورد')
  const note = optionalText(input.note, 'ملاحظة', 500)
  let supplierId: number | null = null
  let supplierName: string
  if (input.supplierId != null) {
    supplierId = nonNegativeInt(input.supplierId, 'المورد')
    const s = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(supplierId) as { name: string } | undefined
    if (!s) throw new AppError('NOT_FOUND', 'المورد غير موجود')
    supplierName = s.name
  } else {
    supplierName = optionalText(input.supplierName, 'اسم المورد', 120) ?? 'مورد نقدي'
  }

  const tx = db.transaction((): Purchase => {
    let total = 0
    const prepared: Array<{ productId: number; quantity: number; unitCost: number; balanceAfter: number }> = []
    for (const [productId, l] of merged) {
      const p = db.prepare('SELECT id, quantity FROM products WHERE id = ?').get(productId) as { id: number; quantity: number } | undefined
      if (!p) throw new AppError('NOT_FOUND', `المنتج (معرف ${productId}) غير موجود`)
      total += l.quantity * l.unitCost
      prepared.push({ ...l, balanceAfter: p.quantity + l.quantity })
    }
    if (paid > total) throw new AppError('VALIDATION', 'المدفوع للمورد أكبر من إجمالي الشراء')
    const receiptNo = nextReceiptNo(db)
    const info = db
      .prepare(`INSERT INTO purchases (receipt_no, supplier_id, supplier_name, total, paid, note) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(receiptNo, supplierId, supplierName, total, paid, note)
    const purchaseId = Number(info.lastInsertRowid)
    const insertItem = db.prepare('INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES (?, ?, ?, ?)')
    const updateStock = db.prepare(`UPDATE products SET quantity = ?, purchase_price = ?, updated_at = datetime('now') WHERE id = ?`)
    const hist = db.prepare('INSERT INTO price_history (product_id, field, old_value, new_value) VALUES (?, ?, ?, ?)')
    for (const line of prepared) {
      insertItem.run(purchaseId, line.productId, line.quantity, line.unitCost)
      const old = db.prepare('SELECT purchase_price FROM products WHERE id = ?').get(line.productId) as { purchase_price: number }
      updateStock.run(line.balanceAfter, line.unitCost, line.productId)
      if (old.purchase_price !== line.unitCost) hist.run(line.productId, 'purchase_price', old.purchase_price, line.unitCost)
      recordMovementV2(db, {
        productId: line.productId, movementType: 'PURCHASE', quantityChange: line.quantity,
        balanceAfter: line.balanceAfter, reason: `شراء من مورد — سند ${receiptNo}`,
        refType: 'PURCHASE', refId: purchaseId
      })
    }
    logAudit(db, 'CREATE_PURCHASE', 'purchase', purchaseId, `${receiptNo} — ${total} دج`)
    return getPurchase(db, purchaseId)!
  })
  return tx()
}

export function paySupplier(db: Database.Database, purchaseId: number, amount: number, note?: string | null): SupplierPayment {
  const amt = positiveInt(amount, 'قيمة الدفعة')
  const memo = optionalText(note, 'ملاحظة', 500)
  const tx = db.transaction(() => {
    const p = db.prepare('SELECT id, total, paid FROM purchases WHERE id = ?').get(purchaseId) as { id: number; total: number; paid: number } | undefined
    if (!p) throw new AppError('NOT_FOUND', 'سند الشراء غير موجود')
    const paidSoFar =
      p.paid +
      ((db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM supplier_payments WHERE purchase_id = ?').get(purchaseId) as { s: number }).s)
    if (amt > p.total - paidSoFar) {
      throw new AppError('VALIDATION', `الدفعة أكبر من المتبقي (${Math.max(0, p.total - paidSoFar)} دج)`)
    }
    const info = db.prepare('INSERT INTO supplier_payments (purchase_id, amount, note) VALUES (?, ?, ?)').run(purchaseId, amt, memo)
    logAudit(db, 'SUPPLIER_PAYMENT', 'purchase', purchaseId, `دفعة ${amt} دج`)
    return {
      id: Number(info.lastInsertRowid), purchaseId, amount: amt, note: memo, createdAt: ''
    } satisfies SupplierPayment
  })
  return tx()
}

export function listSupplierPayments(db: Database.Database, purchaseId: number): SupplierPayment[] {
  const rows = db
    .prepare('SELECT id, purchase_id, amount, note, created_at FROM supplier_payments WHERE purchase_id = ? ORDER BY id')
    .all(purchaseId) as Array<{ id: number; purchase_id: number; amount: number; note: string | null; created_at: string }>
  return rows.map((r) => ({ id: r.id, purchaseId: r.purchase_id, amount: r.amount, note: r.note, createdAt: r.created_at }))
}

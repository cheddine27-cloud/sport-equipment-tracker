/**
 * Sales service — checkout, cancellation and returns. All money is integer
 * DZD; every multi-step operation runs inside a single SQLite transaction so
 * stock deduction, sale rows and movement history are atomic.
 */
import type Database from 'better-sqlite3'
import {
  AppError,
  type ReturnInput,
  type ReturnRecord,
  type Sale,
  type SaleInput,
  type SaleItem
} from '../../shared/types'
import { nonNegativeInt, optionalText, positiveInt, requireReason } from './validation'
import { recordMovementV2 } from './movements'
import { logAudit } from './audit'

interface SaleRow {
  id: number
  invoice_no: string
  subtotal: number
  discount: number
  total: number
  paid: number
  balance: number
  payment_method: 'CASH' | 'CARD'
  status: 'COMPLETED' | 'CANCELLED'
  cancelled_at: string | null
  cancel_reason: string | null
  note: string | null
  customer_id: number | null
  customer_name: string | null
  created_at: string
}

interface SaleItemRow {
  id: number
  sale_id: number
  product_id: number
  product_code: string
  product_name: string
  quantity: number
  unit_price: number
  purchase_price: number
  returned_qty: number
}

function mapSale(r: SaleRow, items: SaleItem[]): Sale {
  return {
    id: r.id,
    invoiceNo: r.invoice_no,
    subtotal: r.subtotal,
    discount: r.discount,
    total: r.total,
    paid: r.paid,
    balance: r.balance,
    paymentMethod: r.payment_method,
    status: r.status,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
    note: r.note,
    customerId: r.customer_id,
    customerName: r.customer_name,
    createdAt: r.created_at,
    items
  }
}

function mapItem(r: SaleItemRow): SaleItem {
  return {
    id: r.id,
    saleId: r.sale_id,
    productId: r.product_id,
    productCode: r.product_code,
    productName: r.product_name,
    quantity: r.quantity,
    unitPrice: r.unit_price,
    purchasePrice: r.purchase_price,
    returnedQty: r.returned_qty
  }
}

const SALE_SELECT = `SELECT s.*, COALESCE(c.name, NULL) AS cust_name FROM sales s
  LEFT JOIN customers c ON c.id = s.customer_id`

export function getSale(db: Database.Database, id: number): Sale | null {
  const row = db.prepare(`${SALE_SELECT} WHERE s.id = ?`).get(id) as SaleRow | undefined
  if (!row) return null
  const items = db
    .prepare(
      `SELECT si.id, si.sale_id, si.product_id, p.code AS product_code, p.name AS product_name,
              si.quantity, si.unit_price, si.purchase_price, si.returned_qty
              FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ? ORDER BY si.id`
    )
    .all(id) as SaleItemRow[]
  return mapSale(row, items.map(mapItem))
}

export function listSales(db: Database.Database, search = '', limit = 100): Sale[] {
  const params: unknown[] = []
  let sql = SALE_SELECT
  const q = search.trim()
  if (q) {
    sql += ' WHERE (s.invoice_no LIKE ? OR s.customer_name LIKE ?)'
    const like = `%${q.replace(/[%_]/g, (m) => '\\' + m)}%`
    params.push(like, like)
  }
  sql += ' ORDER BY s.id DESC LIMIT ?'
  params.push(limit)
  const rows = db.prepare(sql).all(...params) as SaleRow[]
  return rows.map((r) => mapSale(r, []))
}

/** Next sequential invoice number, e.g. FR-000123. Counter bump is inside the caller's tx. */
function nextInvoiceNo(db: Database.Database): string {
  db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('invoice_counter', '0')`).run()
  const cur = Number(
    (
      db.prepare(`SELECT value FROM settings WHERE key = 'invoice_counter'`).get() as {
        value: string
      }
    ).value
  )
  const next = cur + 1
  db.prepare(`UPDATE settings SET value = ? WHERE key = 'invoice_counter'`).run(String(next))
  return `FR-${String(next).padStart(6, '0')}`
}

/**
 * Records a completed sale: validates lines & availability, deducts stock
 * exactly once per line, writes movements referencing the invoice.
 */
export function createSale(db: Database.Database, input: SaleInput): Sale {
  const linesRaw = Array.isArray(input.lines) ? input.lines : []
  if (linesRaw.length === 0)
    throw new AppError('VALIDATION', 'سلة البيع فارغة — أضف منتجاً واحداً على الأقل')
  if (linesRaw.length > 200) throw new AppError('VALIDATION', 'عدد الأصناف كبير جداً')

  const lines = linesRaw.map((l, i) => ({
    productId: nonNegativeInt(l.productId, `سطر ${i + 1}: المنتج`),
    quantity: positiveInt(l.quantity, `سطر ${i + 1}: الكمية`),
    unitPrice: nonNegativeInt(l.unitPrice, `سطر ${i + 1}: السعر`)
  }))
  // Merge duplicate product lines to guarantee a single deduction per product.
  const merged = new Map<number, { quantity: number; unitPrice: number }>()
  for (const l of lines) {
    const prev = merged.get(l.productId)
    merged.set(l.productId, {
      quantity: (prev?.quantity ?? 0) + l.quantity,
      unitPrice: l.unitPrice
    })
  }

  const discount = nonNegativeInt(input.discount, 'الخصم')
  const paid = nonNegativeInt(input.paid, 'المبلغ المدفوع')
  const method = input.paymentMethod === 'CARD' ? 'CARD' : 'CASH'
  if (input.paymentMethod !== 'CASH' && input.paymentMethod !== 'CARD') {
    throw new AppError('VALIDATION', 'طريقة الدفع غير صالحة')
  }
  const customerName = optionalText(input.customerName, 'اسم الزبون', 120)
  const note = optionalText(input.note, 'ملاحظة', 500)

  const tx = db.transaction((): Sale => {
    let subtotal = 0
    const prepared: Array<{
      productId: number
      quantity: number
      unitPrice: number
      name: string
      code: string
      purchasePrice: number
      balanceAfter: number
    }> = []
    for (const [productId, l] of merged) {
      const p = db
        .prepare(
          'SELECT id, code, name, quantity, purchase_price, active FROM products WHERE id = ?'
        )
        .get(productId) as
        | {
            id: number
            code: string
            name: string
            quantity: number
            purchase_price: number
            active: number
          }
        | undefined
      if (!p) throw new AppError('NOT_FOUND', `المنتج (معرف ${productId}) غير موجود`)
      if (p.active !== 1)
        throw new AppError('VALIDATION', `المنتج «${p.name}» غير مفعّل ولا يمكن بيعه`)
      if (p.quantity < l.quantity) {
        throw new AppError(
          'NEGATIVE_STOCK',
          `الكمية غير كافية لـ «${p.name}»: المتوفر ${p.quantity} والمطلوب ${l.quantity}`
        )
      }
      subtotal += l.quantity * l.unitPrice
      prepared.push({
        productId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        name: p.name,
        code: p.code,
        purchasePrice: p.purchase_price,
        balanceAfter: p.quantity - l.quantity
      })
    }
    if (discount > subtotal) throw new AppError('VALIDATION', 'الخصم أكبر من مجموع الفاتورة')
    const total = subtotal - discount
    if (paid > total) throw new AppError('VALIDATION', 'المبلغ المدفوع أكبر من إجمالي الفاتورة')
    const balance = total - paid

    const invoiceNo = nextInvoiceNo(db)
    const saleInfo = db
      .prepare(
        `INSERT INTO sales (invoice_no, subtotal, discount, total, paid, balance, payment_method,
           status, note, customer_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?)`
      )
      .run(invoiceNo, subtotal, discount, total, paid, balance, method, note, customerName)
    const saleId = Number(saleInfo.lastInsertRowid)
    if (paid > 0) {
      db.prepare(`INSERT INTO sale_payments (sale_id, amount, note) VALUES (?, ?, ?)`).run(
        saleId,
        paid,
        'الدفع عند إنشاء الفاتورة'
      )
    }

    const insertItem = db.prepare(
      `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, purchase_price)
       VALUES (?, ?, ?, ?, ?)`
    )
    const updateQty = db.prepare(
      `UPDATE products SET quantity = ?, updated_at = datetime('now') WHERE id = ?`
    )
    for (const line of prepared) {
      insertItem.run(saleId, line.productId, line.quantity, line.unitPrice, line.purchasePrice)
      updateQty.run(line.balanceAfter, line.productId)
      recordMovementV2(db, {
        productId: line.productId,
        movementType: 'SALE',
        quantityChange: -line.quantity,
        balanceAfter: line.balanceAfter,
        reason: `بيع — فاتورة ${invoiceNo}`,
        refType: 'SALE',
        refId: saleId
      })
    }

    // Link an existing customer by exact name when available (optional nicety).
    if (customerName) {
      const cust = db
        .prepare('SELECT id FROM customers WHERE name = ? AND active = 1')
        .get(customerName) as { id: number } | undefined
      if (cust) db.prepare('UPDATE sales SET customer_id = ? WHERE id = ?').run(cust.id, saleId)
    }

    logAudit(db, 'CREATE_SALE', 'sale', saleId, `فاتورة ${invoiceNo} — الإجمالي ${total} دج`)
    const s = getSale(db, saleId)
    if (!s) throw new AppError('DB_ERROR', 'تعذّر قراءة الفاتورة بعد إنشائها')
    return s
  })
  return tx()
}

/** Cancel a whole sale: restores stock for unreturned quantities, auditable. */
export function cancelSale(db: Database.Database, saleId: number, reason: string): Sale {
  const why = requireReason(reason)
  const tx = db.transaction((): Sale => {
    const sale = getSale(db, saleId)
    if (!sale) throw new AppError('NOT_FOUND', 'الفاتورة غير موجودة')
    if (sale.status === 'CANCELLED') throw new AppError('VALIDATION', 'الفاتورة ملغاة مسبقاً')

    for (const item of sale.items) {
      const restorable = item.quantity - item.returnedQty
      if (restorable <= 0) continue
      const p = db.prepare('SELECT quantity FROM products WHERE id = ?').get(item.productId) as
        { quantity: number } | undefined
      if (!p)
        throw new AppError('NOT_FOUND', `منتج في الفاتورة لم يعد موجوداً (معرف ${item.productId})`)
      const next = p.quantity + restorable
      db.prepare(`UPDATE products SET quantity = ?, updated_at = datetime('now') WHERE id = ?`).run(
        next,
        item.productId
      )
      recordMovementV2(db, {
        productId: item.productId,
        movementType: 'SALE_CANCEL',
        quantityChange: restorable,
        balanceAfter: next,
        reason: `إلغاء فاتورة ${sale.invoiceNo}: ${why}`,
        refType: 'SALE',
        refId: saleId
      })
    }
    db.prepare(
      `UPDATE sales SET status = 'CANCELLED', cancelled_at = datetime('now'), cancel_reason = ? WHERE id = ?`
    ).run(why, saleId)
    // Record the cash actually returned to the customer as a negative ledger
    // entry. Refunds already recorded via returns were restored stock-wise;
    // their money outflow is captured by those entries, so only the remaining
    // unreturned portion of what the customer paid is refunded here.
    const alreadyRefunded = db
      .prepare(`SELECT COALESCE(SUM(amount_refunded), 0) AS r FROM returns WHERE sale_id = ?`)
      .get(saleId) as { r: number }
    const refundDue = Math.max(0, sale.paid - alreadyRefunded.r)
    if (refundDue > 0) {
      db.prepare(`INSERT INTO sale_payments (sale_id, amount, note) VALUES (?, ?, ?)`).run(
        saleId,
        -refundDue,
        `إلغاء فاتورة — ${why}`
      )
    }
    logAudit(db, 'CANCEL_SALE', 'sale', saleId, `فاتورة ${sale.invoiceNo} — ${why}`)
    const s = getSale(db, saleId)
    if (!s) throw new AppError('DB_ERROR', 'تعذّر قراءة الفاتورة بعد الإلغاء')
    return s
  })
  return tx()
}

/**
 * Partial/full return of one sale line. History is never deleted: a `returns`
 * row records the refund and stock goes back with a RETURN movement.
 */
export function recordReturn(
  db: Database.Database,
  input: ReturnInput
): { sale: Sale; ret: ReturnRecord } {
  const qty = positiveInt(input.quantity, 'كمية الإرجاع')
  const why = requireReason(input.reason)

  const tx = db.transaction(() => {
    const saleRow = db.prepare(`${SALE_SELECT} WHERE s.id = ?`).get(input.saleId) as
      SaleRow | undefined
    if (!saleRow) throw new AppError('NOT_FOUND', 'الفاتورة غير موجودة')
    if (saleRow.status === 'CANCELLED')
      throw new AppError('VALIDATION', 'لا يمكن إرجاع أصناف من فاتورة ملغاة')
    const itemRow = db
      .prepare(
        `SELECT si.id, si.sale_id, si.product_id, p.code AS product_code, p.name AS product_name,
                si.quantity, si.unit_price, si.purchase_price, si.returned_qty
         FROM sale_items si JOIN products p ON p.id = si.product_id
         WHERE si.id = ? AND si.sale_id = ?`
      )
      .get(input.saleItemId, input.saleId) as SaleItemRow | undefined
    if (!itemRow) throw new AppError('NOT_FOUND', 'صنف الفاتورة غير موجود')
    if (itemRow.returned_qty + qty > itemRow.quantity) {
      throw new AppError(
        'VALIDATION',
        `لا يمكن إرجاع أكثر من المبيعة (${itemRow.quantity - itemRow.returned_qty} متاحة للإرجاع)`
      )
    }

    const refunded = qty * itemRow.unit_price
    const p = db.prepare('SELECT quantity FROM products WHERE id = ?').get(itemRow.product_id) as {
      quantity: number
    }
    const next = p.quantity + qty
    db.prepare(`UPDATE products SET quantity = ?, updated_at = datetime('now') WHERE id = ?`).run(
      next,
      itemRow.product_id
    )
    db.prepare('UPDATE sale_items SET returned_qty = returned_qty + ? WHERE id = ?').run(
      qty,
      itemRow.id
    )

    db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('return_counter', '0')`).run()
    const rc =
      Number(
        (
          db.prepare(`SELECT value FROM settings WHERE key = 'return_counter'`).get() as {
            value: string
          }
        ).value
      ) + 1
    db.prepare(`UPDATE settings SET value = ? WHERE key = 'return_counter'`).run(String(rc))
    const returnNo = `RV-${String(rc).padStart(6, '0')}`

    const info = db
      .prepare(
        `INSERT INTO returns (return_no, sale_id, sale_item_id, quantity, amount_refunded, reason)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(returnNo, input.saleId, itemRow.id, qty, refunded, why)
    // Record the actual cash outflow in the payment ledger (negative entry).
    db.prepare(`INSERT INTO sale_payments (sale_id, amount, note) VALUES (?, ?, ?)`).run(
      input.saleId,
      -refunded,
      `إرجاع ${returnNo}`
    )
    recordMovementV2(db, {
      productId: itemRow.product_id,
      movementType: 'RETURN',
      quantityChange: qty,
      balanceAfter: next,
      reason: `إرجاع ${returnNo} — فاتورة ${saleRow.invoice_no}: ${why}`,
      refType: 'RETURN',
      refId: Number(info.lastInsertRowid)
    })
    logAudit(
      db,
      'RECORD_RETURN',
      'sale',
      input.saleId,
      `${returnNo} — ${qty} × ${itemRow.product_name} (${refunded} دج)`
    )
    return {
      ret: {
        id: Number(info.lastInsertRowid),
        returnNo,
        saleId: input.saleId,
        saleItemId: itemRow.id,
        quantity: qty,
        amountRefunded: refunded,
        reason: why,
        createdAt: ''
      } satisfies ReturnRecord,
      sale: getSale(db, input.saleId)!
    }
  })
  return tx()
}

export function listReturnsForSale(db: Database.Database, saleId: number): ReturnRecord[] {
  const rows = db
    .prepare(
      'SELECT id, return_no, sale_id, sale_item_id, quantity, amount_refunded, reason, created_at FROM returns WHERE sale_id = ? ORDER BY id'
    )
    .all(saleId) as Array<{
    id: number
    return_no: string
    sale_id: number
    sale_item_id: number
    quantity: number
    amount_refunded: number
    reason: string
    created_at: string
  }>
  return rows.map((r) => ({
    id: r.id,
    returnNo: r.return_no,
    saleId: r.sale_id,
    saleItemId: r.sale_item_id,
    quantity: r.quantity,
    amountRefunded: r.amount_refunded,
    reason: r.reason,
    createdAt: r.created_at
  }))
}

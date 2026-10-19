/**
 * External orders & deliveries.
 *
 * STOCK-RESERVATION POLICY (documented and enforced here):
 *  - PENDING / CONFIRMED: no stock is deducted; quantities shown are the
 *    current on-hand values (soft reservation only — first confirmed sale wins).
 *  - DISPATCHED: stock is deducted EXACTLY ONCE, guarded by the
 *    `orders.stock_applied` flag inside the same transaction that flips the
 *    status. Re-dispatching can never double-deduct.
 *  - DELIVERED: delivery confirmation; no further stock effect.
 *  - CANCELLED: if stock had been applied (DISPATCHED → CANCELLED) it is
 *    restored once and the flag is cleared. Cancelling a PENDING/CONFIRMED
 *    order has no stock effect. A delivered order cannot be cancelled here —
 *    use returns for post-delivery refunds.
 */
import type Database from 'better-sqlite3'
import {
  AppError,
  type Order,
  type OrderInput,
  type OrderItem,
  type OrderStatus
} from '../../shared/types'
import {
  nonNegativeInt,
  optionalText,
  positiveInt,
  requireReason,
  requireString
} from './validation'
import { recordMovementV2 } from './movements'
import { logAudit } from './audit'

interface OrderRow {
  id: number
  order_no: string
  customer_name: string
  phone: string | null
  address: string | null
  note: string | null
  status: OrderStatus
  stock_applied: number
  created_at: string
  updated_at: string
}

function nextOrderNo(db: Database.Database): string {
  db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('order_counter', '0')`).run()
  const cur =
    Number(
      (
        db.prepare(`SELECT value FROM settings WHERE key = 'order_counter'`).get() as {
          value: string
        }
      ).value
    ) + 1
  db.prepare(`UPDATE settings SET value = ? WHERE key = 'order_counter'`).run(String(cur))
  return `OR-${String(cur).padStart(6, '0')}`
}

export function getOrder(db: Database.Database, id: number): Order | null {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as OrderRow | undefined
  if (!row) return null
  const items = db
    .prepare(
      `SELECT oi.id, oi.order_id, oi.product_id, p.code AS product_code, p.name AS product_name,
              oi.quantity, oi.unit_price FROM order_items oi JOIN products p ON p.id = oi.product_id
              WHERE oi.order_id = ? ORDER BY oi.id`
    )
    .all(id) as Array<{
    id: number
    order_id: number
    product_id: number
    product_code: string
    product_name: string
    quantity: number
    unit_price: number
  }>
  const mappedItems: OrderItem[] = items.map((i) => ({
    id: i.id,
    orderId: i.order_id,
    productId: i.product_id,
    productCode: i.product_code,
    productName: i.product_name,
    quantity: i.quantity,
    unitPrice: i.unit_price
  }))
  return {
    id: row.id,
    orderNo: row.order_no,
    customerName: row.customer_name,
    phone: row.phone,
    address: row.address,
    note: row.note,
    status: row.status,
    stockApplied: row.stock_applied === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: mappedItems,
    total: mappedItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  }
}

const STATUSES: OrderStatus[] = ['PENDING', 'CONFIRMED', 'DISPATCHED', 'DELIVERED', 'CANCELLED']

export function listOrders(
  db: Database.Database,
  status: OrderStatus | 'ALL' = 'ALL',
  limit = 200
): Order[] {
  let rows: OrderRow[]
  if (status === 'ALL') {
    rows = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT ?').all(limit) as OrderRow[]
  } else {
    if (!STATUSES.includes(status)) throw new AppError('VALIDATION', 'حالة الطلب غير صالحة')
    rows = db
      .prepare('SELECT * FROM orders WHERE status = ? ORDER BY id DESC LIMIT ?')
      .all(status, limit) as OrderRow[]
  }
  return rows.map((r) => ({
    id: r.id,
    orderNo: r.order_no,
    customerName: r.customer_name,
    phone: r.phone,
    address: r.address,
    note: r.note,
    status: r.status,
    stockApplied: r.stock_applied === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    items: [],
    total: 0
  }))
}

export function createOrder(db: Database.Database, input: OrderInput): Order {
  const customerName = requireString(input.customerName, 'اسم الزبون', 120)
  const phone = optionalText(input.phone, 'الهاتف', 40)
  const address = optionalText(input.address, 'العنوان', 200)
  const note = optionalText(input.note, 'ملاحظة', 500)
  const linesRaw = Array.isArray(input.lines) ? input.lines : []
  if (linesRaw.length === 0) throw new AppError('VALIDATION', 'الطلب لا يحتوي على أصناف')
  if (linesRaw.length > 100) throw new AppError('VALIDATION', 'عدد الأصناف كبير جداً')
  const lines = linesRaw.map((l, i) => ({
    productId: nonNegativeInt(l.productId, `سطر ${i + 1}: المنتج`),
    quantity: positiveInt(l.quantity, `سطر ${i + 1}: الكمية`),
    unitPrice: nonNegativeInt(l.unitPrice, `سطر ${i + 1}: السعر`)
  }))
  const merged = new Map<number, { quantity: number; unitPrice: number }>()
  for (const l of lines) {
    const prev = merged.get(l.productId)
    merged.set(l.productId, {
      quantity: (prev?.quantity ?? 0) + l.quantity,
      unitPrice: l.unitPrice
    })
  }

  const tx = db.transaction((): Order => {
    // Validate existence + availability at creation time (soft check).
    for (const [productId, l] of merged) {
      const p = db
        .prepare('SELECT name, quantity, active FROM products WHERE id = ?')
        .get(productId) as { name: string; quantity: number; active: number } | undefined
      if (!p) throw new AppError('NOT_FOUND', `منتج (معرف ${productId}) غير موجود`)
      if (p.active !== 1) throw new AppError('VALIDATION', `المنتج «${p.name}» غير مفعّل`)
      if (p.quantity < l.quantity) {
        throw new AppError(
          'NEGATIVE_STOCK',
          `الكمية غير متوفرة حالياً لـ «${p.name}»: المتوفر ${p.quantity} والمطلوب ${l.quantity}`
        )
      }
    }
    const orderNo = nextOrderNo(db)
    const info = db
      .prepare(
        `INSERT INTO orders (order_no, customer_name, phone, address, note, status) VALUES (?, ?, ?, ?, ?, 'PENDING')`
      )
      .run(orderNo, customerName, phone, address, note)
    const orderId = Number(info.lastInsertRowid)
    const ins = db.prepare(
      'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)'
    )
    for (const [productId, l] of merged) ins.run(orderId, productId, l.quantity, l.unitPrice)
    logAudit(db, 'CREATE_ORDER', 'order', orderId, `${orderNo} — ${customerName}`)
    return getOrder(db, orderId)!
  })
  return tx()
}

/** Allowed forward transitions per policy above. */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'DISPATCHED', 'CANCELLED'],
  CONFIRMED: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: []
}

export function setOrderStatus(
  db: Database.Database,
  orderId: number,
  to: OrderStatus,
  reason?: string
): Order {
  if (!STATUSES.includes(to)) throw new AppError('VALIDATION', 'حالة الطلب غير صالحة')
  const tx = db.transaction((): Order => {
    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as OrderRow | undefined
    if (!row) throw new AppError('NOT_FOUND', 'الطلب غير موجود')
    const from = row.status
    if (from === to) throw new AppError('VALIDATION', 'الطلب بهذه الحالة مسبقاً')
    if (!TRANSITIONS[from].includes(to)) {
      throw new AppError(
        'VALIDATION',
        `لا يمكن تحويل الطلب من ${ORDER_STATUS_LABELS[from]} إلى ${ORDER_STATUS_LABELS[to]}`
      )
    }
    const items = db
      .prepare('SELECT id, product_id, quantity FROM order_items WHERE order_id = ?')
      .all(orderId) as Array<{ id: number; product_id: number; quantity: number }>

    if (to === 'DISPATCHED' && row.stock_applied === 0) {
      // Deduct exactly once — validated against CURRENT stock.
      for (const it of items) {
        const p = db
          .prepare('SELECT name, quantity FROM products WHERE id = ?')
          .get(it.product_id) as { name: string; quantity: number } | undefined
        if (!p) throw new AppError('NOT_FOUND', 'منتج ضمن الطلب لم يعد موجوداً')
        if (p.quantity < it.quantity) {
          throw new AppError(
            'NEGATIVE_STOCK',
            `لا يكفي المخزون لإرسال «${p.name}»: المتوفر ${p.quantity} والمطلوب ${it.quantity}`
          )
        }
      }
      for (const it of items) {
        const p = db.prepare('SELECT quantity FROM products WHERE id = ?').get(it.product_id) as {
          quantity: number
        }
        const next = p.quantity - it.quantity
        db.prepare(
          `UPDATE products SET quantity = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(next, it.product_id)
        recordMovementV2(db, {
          productId: it.product_id,
          movementType: 'SALE',
          quantityChange: -it.quantity,
          balanceAfter: next,
          reason: `إرسال طلب ${row.order_no}`,
          refType: 'ORDER',
          refId: orderId
        })
      }
      db.prepare(`UPDATE orders SET stock_applied = 1 WHERE id = ?`).run(orderId)
    }

    if (to === 'CANCELLED') {
      if (row.stock_applied === 1) {
        // Restore stock exactly once and clear the flag.
        for (const it of items) {
          const p = db.prepare('SELECT quantity FROM products WHERE id = ?').get(it.product_id) as {
            quantity: number
          }
          const next = p.quantity + it.quantity
          db.prepare(
            `UPDATE products SET quantity = ?, updated_at = datetime('now') WHERE id = ?`
          ).run(next, it.product_id)
          recordMovementV2(db, {
            productId: it.product_id,
            movementType: 'SALE_CANCEL',
            quantityChange: it.quantity,
            balanceAfter: next,
            reason: `إلغاء طلب ${row.order_no}`,
            refType: 'ORDER',
            refId: orderId
          })
        }
        db.prepare(`UPDATE orders SET stock_applied = 0 WHERE id = ?`).run(orderId)
      }
    }

    const why = to === 'CANCELLED' ? requireReason(reason ?? '') : optionalText(reason, 'سبب', 300)
    db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(
      to,
      orderId
    )
    logAudit(
      db,
      'ORDER_STATUS',
      'order',
      orderId,
      `${row.order_no}: ${from} → ${to}${why ? ` (${why})` : ''}`
    )
    return getOrder(db, orderId)!
  })
  return tx()
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: 'قيد الانتظار',
  CONFIRMED: 'مؤكد',
  DISPATCHED: 'تم الإرسال',
  DELIVERED: 'تم التسليم',
  CANCELLED: 'ملغى'
}

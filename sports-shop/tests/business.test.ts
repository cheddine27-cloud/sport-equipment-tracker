/**
 * Business-rule tests for Phase B–E services: sales, returns, cancellations,
 * orders (stock policy), purchases, expenses and report calculations.
 * All databases are isolated temporary files; nothing touches userData.
 */
import { describe, it, expect, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { createTestDb, cleanupAll, makeProductInput, expenseCategoryIdByName } from './helpers'
import { createProduct } from '../src/main/services/products'
import {
  createSale,
  cancelSale,
  recordReturn,
  getSale,
  listReturnsForSale
} from '../src/main/services/sales'
import { createOrder, setOrderStatus, getOrder } from '../src/main/services/orders'
import { createPurchase, paySupplier } from '../src/main/services/purchases'
import { createExpense, sumExpenses } from '../src/main/services/expenses'
import { reportSummary } from '../src/main/services/reports'
import { movementsForProduct } from '../src/main/services/movements'

let db: Database.Database | null = null
function fresh(): Database.Database {
  db = createTestDb()
  return db
}
afterEach(() => {
  cleanupAll()
  db = null
})

function qty(d: Database.Database, productId: number): number {
  const r = d.prepare('SELECT quantity FROM products WHERE id = ?').get(productId) as {
    quantity: number
  }
  return r.quantity
}

describe('sales', () => {
  it('creates a sale, deducts stock once, records movement and invoice number', () => {
    const d = fresh()
    const p = createProduct(d, makeProductInput(d, { code: 'SALE-1', openingQuantity: 10 }))
    const sale = createSale(d, {
      lines: [{ productId: p.id, quantity: 4, unitPrice: 1500 }],
      discount: 0,
      paid: 6000,
      paymentMethod: 'CASH'
    })
    expect(sale.invoiceNo).toMatch(/^FR-\d{6}$/)
    expect(sale.subtotal).toBe(6000)
    expect(sale.total).toBe(6000)
    expect(sale.balance).toBe(0)
    expect(qty(d, p.id)).toBe(6)
    const mv = movementsForProduct(d, p.id)
    expect(mv.some((m) => m.movementType === 'SALE' && m.quantityChange === -4)).toBe(true)
    // COGS snapshot stored at sale time
    expect(sale.items[0].purchasePrice).toBe(1000)
  })

  it('merges duplicate product lines into a single deduction', () => {
    const d = fresh()
    const p = createProduct(d, makeProductInput(d, { code: 'SALE-MERGE', openingQuantity: 10 }))
    createSale(d, {
      lines: [
        { productId: p.id, quantity: 2, unitPrice: 1500 },
        { productId: p.id, quantity: 3, unitPrice: 1500 }
      ],
      discount: 0,
      paid: 7500,
      paymentMethod: 'CASH'
    })
    expect(qty(d, p.id)).toBe(5)
    const sale = getSale(d, 1)!
    expect(sale.items.length).toBe(1)
    expect(sale.items[0].quantity).toBe(5)
  })

  it('rejects overselling and leaves stock unchanged (transaction rollback)', () => {
    const d = fresh()
    const p = createProduct(d, makeProductInput(d, { code: 'SALE-OVER', openingQuantity: 3 }))
    expect(() =>
      createSale(d, {
        lines: [{ productId: p.id, quantity: 5, unitPrice: 1500 }],
        discount: 0,
        paid: 0,
        paymentMethod: 'CASH'
      })
    ).toThrow(/غير كافية/)
    expect(qty(d, p.id)).toBe(3)
    expect(d.prepare('SELECT COUNT(*) AS n FROM sales').get()).toEqual({ n: 0 })
    expect(d.prepare('SELECT COUNT(*) AS n FROM stock_movements_v2').get()).toEqual({ n: 0 })
  })

  it('validates discount and payment amounts', () => {
    const d = fresh()
    const p = createProduct(d, makeProductInput(d, { code: 'SALE-DISC' }))
    expect(() =>
      createSale(d, {
        lines: [{ productId: p.id, quantity: 1, unitPrice: 1000 }],
        discount: 1500,
        paid: 0,
        paymentMethod: 'CASH'
      })
    ).toThrow(/الخصم/)
    expect(() =>
      createSale(d, {
        lines: [{ productId: p.id, quantity: 1, unitPrice: 1000 }],
        discount: 0,
        paid: 1200,
        paymentMethod: 'CASH'
      })
    ).toThrow(/المدفوع/)
    expect(() => createSale(d, { lines: [], discount: 0, paid: 0, paymentMethod: 'CASH' })).toThrow(
      /فارغة/
    )
  })

  it('records outstanding balance for partial payment', () => {
    const d = fresh()
    const p = createProduct(d, makeProductInput(d, { code: 'SALE-BAL' }))
    const sale = createSale(d, {
      lines: [{ productId: p.id, quantity: 2, unitPrice: 1500 }],
      discount: 300,
      paid: 2000,
      paymentMethod: 'CASH'
    })
    expect(sale.total).toBe(2700)
    expect(sale.balance).toBe(700)
  })

  it('cancelling a sale restores stock exactly once and is auditable', () => {
    const d = fresh()
    const p = createProduct(d, makeProductInput(d, { code: 'SALE-CXL', openingQuantity: 10 }))
    const sale = createSale(d, {
      lines: [{ productId: p.id, quantity: 4, unitPrice: 1500 }],
      discount: 0,
      paid: 6000,
      paymentMethod: 'CASH'
    })
    const cancelled = cancelSale(d, sale.id, 'خطأ في الإدخال')
    expect(cancelled.status).toBe('CANCELLED')
    expect(qty(d, p.id)).toBe(10)
    // second cancellation must fail — no double restoration
    expect(() => cancelSale(d, sale.id, 'مرة أخرى')).toThrow(/ملغاة/)
    expect(qty(d, p.id)).toBe(10)
    const types = movementsForProduct(d, p.id).map((m) => m.movementType)
    expect(types.filter((t) => t === 'SALE_CANCEL').length).toBe(1)
  })

  it('partial returns restore stock, cap at sold quantity, and forbid over-refund', () => {
    const d = fresh()
    const p = createProduct(d, makeProductInput(d, { code: 'SALE-RET', openingQuantity: 10 }))
    const sale = createSale(d, {
      lines: [{ productId: p.id, quantity: 4, unitPrice: 1500 }],
      discount: 0,
      paid: 6000,
      paymentMethod: 'CASH'
    })
    const first = recordReturn(d, {
      saleId: sale.id,
      saleItemId: sale.items[0].id,
      quantity: 2,
      reason: 'منتج معيب'
    })
    expect(first.ret.returnNo).toMatch(/^RV-\d{6}$/)
    expect(first.ret.amountRefunded).toBe(3000)
    expect(qty(d, p.id)).toBe(8)
    // returning more than remaining sold qty must fail
    expect(() =>
      recordReturn(d, {
        saleId: sale.id,
        saleItemId: sale.items[0].id,
        quantity: 3,
        reason: 'إرجاع إضافي'
      })
    ).toThrow(/لا يمكن إرجاع/)
    expect(qty(d, p.id)).toBe(8)
    const after = recordReturn(d, {
      saleId: sale.id,
      saleItemId: sale.items[0].id,
      quantity: 2,
      reason: 'تغيير رأي'
    })
    expect(after.sale.items[0].returnedQty).toBe(4)
    expect(listReturnsForSale(d, sale.id).length).toBe(2)
  })

  it('return requires a reason', () => {
    const d = fresh()
    const p = createProduct(d, makeProductInput(d, { code: 'SALE-RETN' }))
    const sale = createSale(d, {
      lines: [{ productId: p.id, quantity: 1, unitPrice: 1500 }],
      discount: 0,
      paid: 1500,
      paymentMethod: 'CASH'
    })
    expect(() =>
      recordReturn(d, {
        saleId: sale.id,
        saleItemId: sale.items[0].id,
        quantity: 1,
        reason: '   '
      })
    ).toThrow(/السبب|سبب/)
  })
})

describe('orders (reservation policy: deduct only on DISPATCHED, exactly once)', () => {
  it('creation does not change stock; dispatch deducts; invalid transitions rejected', () => {
    const d = fresh()
    const p = createProduct(d, makeProductInput(d, { code: 'ORD-1', openingQuantity: 10 }))
    const order = createOrder(d, {
      customerName: 'زبون تجريبي',
      lines: [{ productId: p.id, quantity: 6, unitPrice: 1500 }]
    })
    expect(order.status).toBe('PENDING')
    expect(qty(d, p.id)).toBe(10) // soft reservation only

    const confirmed = setOrderStatus(d, order.id, 'CONFIRMED')
    expect(confirmed.status).toBe('CONFIRMED')
    expect(qty(d, p.id)).toBe(10)

    const dispatched = setOrderStatus(d, order.id, 'DISPATCHED')
    expect(dispatched.status).toBe('DISPATCHED')
    expect(qty(d, p.id)).toBe(4)

    const delivered = setOrderStatus(d, order.id, 'DELIVERED')
    expect(delivered.status).toBe('DELIVERED')
    expect(qty(d, p.id)).toBe(4) // no second deduction
    // terminal state — no further transitions
    expect(() => setOrderStatus(d, order.id, 'CANCELLED')).toThrow()
  })

  it('dispatch is idempotent even when skipping CONFIRMED (single deduction via stock_applied)', () => {
    const d = fresh()
    const p = createProduct(d, makeProductInput(d, { code: 'ORD-IDEM', openingQuantity: 10 }))
    const order = createOrder(d, {
      customerName: 'زبون',
      lines: [{ productId: p.id, quantity: 5, unitPrice: 1500 }]
    })
    setOrderStatus(d, order.id, 'DISPATCHED')
    expect(qty(d, p.id)).toBe(5)
    // simulate re-entry attempt: same status again must be rejected
    expect(() => setOrderStatus(d, order.id, 'DISPATCHED')).toThrow(/مسبقاً/)
    expect(qty(d, p.id)).toBe(5)
  })

  it('cancelling a dispatched order restores stock; cancelling pending does not', () => {
    const d = fresh()
    const p = createProduct(d, makeProductInput(d, { code: 'ORD-CXL', openingQuantity: 10 }))
    const o1 = createOrder(d, {
      customerName: 'أ',
      lines: [{ productId: p.id, quantity: 4, unitPrice: 1500 }]
    })
    setOrderStatus(d, o1.id, 'CANCELLED', 'إلغاء من الزبون')
    expect(qty(d, p.id)).toBe(10)

    const o2 = createOrder(d, {
      customerName: 'ب',
      lines: [{ productId: p.id, quantity: 3, unitPrice: 1500 }]
    })
    setOrderStatus(d, o2.id, 'DISPATCHED')
    expect(qty(d, p.id)).toBe(7)
    setOrderStatus(d, o2.id, 'CANCELLED', 'مرتجع بعد الإرسال')
    expect(qty(d, p.id)).toBe(10)
    // cannot cancel twice
    expect(() => setOrderStatus(d, o2.id, 'CANCELLED')).toThrow()
    expect(qty(d, p.id)).toBe(10)
  })

  it('dispatch fails when stock dropped since order creation (rollback keeps everything intact)', () => {
    const d = fresh()
    const p = createProduct(d, makeProductInput(d, { code: 'ORD-RACE', openingQuantity: 10 }))
    const order = createOrder(d, {
      customerName: 'ج',
      lines: [{ productId: p.id, quantity: 8, unitPrice: 1500 }]
    })
    // someone sells most of the stock meanwhile
    createSale(d, {
      lines: [{ productId: p.id, quantity: 6, unitPrice: 1500 }],
      discount: 0,
      paid: 9000,
      paymentMethod: 'CASH'
    })
    expect(qty(d, p.id)).toBe(4)
    expect(() => setOrderStatus(d, order.id, 'DISPATCHED')).toThrow(/لا يكفي المخزون/)
    expect(qty(d, p.id)).toBe(4)
    expect(getOrder(d, order.id)!.status).toBe('PENDING')
    expect(getOrder(d, order.id)!.stockApplied).toBe(false)
  })

  it('rejects ordering more than currently available', () => {
    const d = fresh()
    const p = createProduct(d, makeProductInput(d, { code: 'ORD-OVER', openingQuantity: 2 }))
    expect(() =>
      createOrder(d, {
        customerName: 'د',
        lines: [{ productId: p.id, quantity: 5, unitPrice: 1500 }]
      })
    ).toThrow(/غير متوفرة/)
  })
})

describe('purchases and suppliers', () => {
  it('purchase increases stock, updates cost price, logs movement and price history', () => {
    const d = fresh()
    const p = createProduct(d, makeProductInput(d, { code: 'PUR-1', openingQuantity: 5 }))
    const purchase = createPurchase(d, {
      supplierName: 'مورد تجريبي',
      lines: [{ productId: p.id, quantity: 7, unitCost: 1200 }],
      paid: 5000
    })
    expect(purchase.receiptNo).toMatch(/^PO-\d{6}$/)
    expect(qty(d, p.id)).toBe(12)
    const updated = d.prepare('SELECT purchase_price FROM products WHERE id = ?').get(p.id) as {
      purchase_price: number
    }
    expect(updated.purchase_price).toBe(1200)
    const ph = d
      .prepare('SELECT COUNT(*) AS n FROM price_history WHERE product_id = ? AND field = ?')
      .get(p.id, 'purchase_price') as { n: number }
    expect(ph.n).toBe(1)
    const types = movementsForProduct(d, p.id).map((m) => m.movementType)
    expect(types).toContain('PURCHASE')
  })

  it('supplier payments cannot exceed remaining debt', () => {
    const d = fresh()
    const p = createProduct(d, makeProductInput(d, { code: 'PUR-PAY' }))
    const purchase = createPurchase(d, {
      supplierName: 'مورد',
      lines: [{ productId: p.id, quantity: 2, unitCost: 1000 }],
      paid: 1000
    })
    expect(purchase.balance).toBe(1000)
    paySupplier(d, purchase.id, 600)
    expect(() => paySupplier(d, purchase.id, 500)).toThrow(/المتبقي/)
    paySupplier(d, purchase.id, 400)
    expect(() => paySupplier(d, purchase.id, 1)).toThrow(/المتبقي/)
  })

  it('failed purchase rolls back completely', () => {
    const d = fresh()
    const p = createProduct(d, makeProductInput(d, { code: 'PUR-RB', openingQuantity: 5 }))
    expect(() =>
      createPurchase(d, {
        supplierName: 'مورد',
        lines: [
          { productId: p.id, quantity: 3, unitCost: 1000 },
          { productId: 99999, quantity: 1, unitCost: 1000 }
        ],
        paid: 0
      })
    ).toThrow()
    expect(qty(d, p.id)).toBe(5)
    expect(d.prepare('SELECT COUNT(*) AS n FROM purchases').get()).toEqual({ n: 0 })
    expect(d.prepare('SELECT COUNT(*) AS n FROM stock_movements_v2').get()).toEqual({ n: 0 })
  })
})

describe('expenses', () => {
  it('records expenses and sums them by period', () => {
    const d = fresh()
    const cat = expenseCategoryIdByName(d, 'إيجار')
    createExpense(d, {
      categoryId: cat,
      amount: 20000,
      spentOn: '2026-10-05',
      description: 'إيجار أكتوبر'
    })
    createExpense(d, { categoryId: cat, amount: 5000, spentOn: '2026-09-01' })
    expect(sumExpenses(d, '2026-10-01', '2026-10-31')).toBe(20000)
    expect(() => createExpense(d, { categoryId: cat, amount: -1, spentOn: '2026-10-05' })).toThrow()
    expect(() =>
      createExpense(d, { categoryId: cat, amount: 100, spentOn: 'not-a-date' })
    ).toThrow()
  })
})

describe('reports', () => {
  it('computes revenue, cash, receivables, COGS, gross and net profit from stored rows', () => {
    const d = fresh()
    const p = createProduct(d, makeProductInput(d, { code: 'REP-1', openingQuantity: 10 }))
    // sale: 2 × 1500 = 3000, discount 200 → total 2800, paid 2000 → balance 800
    const sale = createSale(d, {
      lines: [{ productId: p.id, quantity: 2, unitPrice: 1500 }],
      discount: 200,
      paid: 2000,
      paymentMethod: 'CASH'
    })
    // return 1 unit → refund 1500
    recordReturn(d, {
      saleId: sale.id,
      saleItemId: sale.items[0].id,
      quantity: 1,
      reason: 'عيّب'
    })
    const cat = expenseCategoryIdByName(d, 'إيجار')
    createExpense(d, {
      categoryId: cat,
      amount: 1000,
      spentOn: new Date().toISOString().slice(0, 10)
    })

    const today = new Date().toISOString().slice(0, 10)
    const s = reportSummary(d, today, today)
    expect(s.revenue).toBe(2800)
    expect(s.discounts).toBe(200)
    expect(s.refunds).toBe(1500)
    expect(s.cogs).toBe(1000) // (2-1) sold-and-kept × purchase price 1000
    expect(s.grossProfit).toBe(2800 - 1500 - 1000)
    expect(s.expensesTotal).toBe(1000)
    expect(s.netProfit).toBe(s.grossProfit - 1000)
    // cash received vs revenue distinction: paid was 2000, refund 1500 → cash 500
    expect(s.cashReceived).toBe(500)
    expect(s.receivables).toBe(800)
  })
})

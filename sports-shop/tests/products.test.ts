/**
 * Product & stock service tests (business logic against real SQLite).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { AppError } from '../src/shared/types'
import {
  createProduct,
  updateProduct,
  receiveStock,
  correctStock,
  getProduct,
  listProducts,
  getMovementsForProduct,
  listCategories
} from '../src/main/services/products'
import { createTestDb, cleanupAll, makeProductInput, categoryIdByName } from './helpers'

afterEach(cleanupAll)

describe('products: creation', () => {
  it('creates a product with opening stock and records an OPENING movement', () => {
    const db = createTestDb()
    const p = createProduct(db, makeProductInput(db, { openingQuantity: 10 }))
    expect(p.id).toBeGreaterThan(0)
    expect(p.quantity).toBe(10)
    expect(p.active).toBe(true)

    const movements = getMovementsForProduct(db, p.id)
    expect(movements).toHaveLength(1)
    expect(movements[0].movementType).toBe('OPENING')
    expect(movements[0].quantityChange).toBe(10)
    expect(movements[0].balanceAfter).toBe(10)
  })

  it('allows zero opening stock without an OPENING movement', () => {
    const db = createTestDb()
    const p = createProduct(db, makeProductInput(db, { code: 'TEST-ZERO', openingQuantity: 0 }))
    expect(p.quantity).toBe(0)
    expect(getMovementsForProduct(db, p.id)).toHaveLength(0)
  })

  it('rejects duplicate product codes', () => {
    const db = createTestDb()
    createProduct(db, makeProductInput(db))
    expect(() => createProduct(db, makeProductInput(db))).toThrow(AppError)
    try {
      createProduct(db, makeProductInput(db))
    } catch (e) {
      expect((e as AppError).code).toBe('DUPLICATE_CODE')
    }
    // Still exactly one product row — no partial insert happened.
    expect(listProducts(db)).toHaveLength(1)
  })

  it('rejects negative prices', () => {
    const db = createTestDb()
    for (const field of ['purchasePrice', 'salePrice', 'externalPrice'] as const) {
      expect(() =>
        createProduct(db, makeProductInput(db, { [field]: -5, code: `NEG-${field}` }))
      ).toThrow(AppError)
    }
  })

  it('rejects non-integer and negative quantities', () => {
    const db = createTestDb()
    expect(() =>
      createProduct(db, makeProductInput(db, { code: 'Q-NEG', openingQuantity: -1 }))
    ).toThrow(AppError)
    expect(() =>
      createProduct(db, makeProductInput(db, { code: 'Q-FRAC', openingQuantity: 2.5 }))
    ).toThrow(AppError)
    expect(() =>
      createProduct(db, makeProductInput(db, { code: 'MIN-NEG', minStock: -3 }))
    ).toThrow(AppError)
  })

  it('rejects unknown categories', () => {
    const db = createTestDb()
    const bogus = categoryIdByName(db, 'العتاد الرياضي') + 999
    expect(() =>
      createProduct(db, makeProductInput(db, { code: 'BADCAT', categoryId: bogus }))
    ).toThrow(AppError)
  })

  it('lists the three seeded categories', () => {
    const db = createTestDb()
    expect(listCategories(db).map((c) => c.name)).toEqual([
      'الملابس الرياضية',
      'العتاد الرياضي',
      'شبه الطبي'
    ])
  })
})

describe('products: update', () => {
  it('updates metadata WITHOUT changing the stock quantity', () => {
    const db = createTestDb()
    const p = createProduct(db, makeProductInput(db, { openingQuantity: 10 }))
    const updated = updateProduct(db, {
      id: p.id,
      code: p.code,
      name: 'اسم جديد للمنتج',
      categoryId: p.categoryId,
      purchasePrice: 1200,
      salePrice: 1900,
      externalPrice: 2100,
      minStock: 4,
      active: true
    })
    expect(updated.name).toBe('اسم جديد للمنتج')
    expect(updated.salePrice).toBe(1900)
    expect(updated.quantity).toBe(10) // untouched
    // Update must not fabricate a movement.
    expect(getMovementsForProduct(db, p.id)).toHaveLength(1)
  })

  it('supports deactivation instead of destructive deletion', () => {
    const db = createTestDb()
    const p = createProduct(db, makeProductInput(db))
    const off = updateProduct(db, { ...p, active: false })
    expect(off.active).toBe(false)
    expect(listProducts(db)).toHaveLength(0) // hidden by default filter
    expect(listProducts(db, { includeInactive: true })).toHaveLength(1)
    expect(getProduct(db, p.id)).not.toBeNull() // history preserved
  })

  it("rejects renaming to another product's code", () => {
    const db = createTestDb()
    createProduct(db, makeProductInput(db, { code: 'A-1' }))
    const b = createProduct(db, makeProductInput(db, { code: 'B-2' }))
    expect(() => updateProduct(db, { ...b, code: 'A-1' })).toThrow(AppError)
  })

  it('accepts re-saving the same unchanged code (excludeId path)', () => {
    const db = createTestDb()
    const p = createProduct(db, makeProductInput(db, { code: 'SAME-1' }))
    const same = updateProduct(db, { ...p, active: true })
    expect(same.code).toBe('SAME-1')
  })
})

describe('stock: receive batch', () => {
  it('increases the existing product quantity without creating a duplicate', () => {
    const db = createTestDb()
    const p = createProduct(db, makeProductInput(db, { openingQuantity: 10 }))
    const after = receiveStock(db, { productId: p.id, quantity: 5 })
    expect(after.id).toBe(p.id)
    expect(after.quantity).toBe(15)
    expect(listProducts(db)).toHaveLength(1) // no new product row
    const movements = getMovementsForProduct(db, p.id)
    expect(movements[0].movementType).toBe('RECEIPT')
    expect(movements[0].quantityChange).toBe(5)
    expect(movements[0].balanceAfter).toBe(15)
  })

  it('rejects zero/negative/non-integer batch sizes and unknown products', () => {
    const db = createTestDb()
    const p = createProduct(db, makeProductInput(db))
    for (const q of [0, -3, 1.5]) {
      expect(() => receiveStock(db, { productId: p.id, quantity: q })).toThrow(AppError)
    }
    expect(() => receiveStock(db, { productId: 9999, quantity: 2 })).toThrow(AppError)
    expect(getProduct(db, p.id)?.quantity).toBe(10) // unchanged after failures
  })
})

describe('stock: authorized correction', () => {
  it('requires a reason', () => {
    const db = createTestDb()
    const p = createProduct(db, makeProductInput(db, { openingQuantity: 10 }))
    expect(() => correctStock(db, { productId: p.id, newQuantity: 8, reason: '' })).toThrow(
      AppError
    )
    expect(() => correctStock(db, { productId: p.id, newQuantity: 8, reason: '   ' })).toThrow(
      AppError
    )
  })

  it('records the correct signed movement (down and up)', () => {
    const db = createTestDb()
    const p = createProduct(db, makeProductInput(db, { openingQuantity: 10 }))
    const down = correctStock(db, { productId: p.id, newQuantity: 8, reason: 'جرد: تلف وحدتين' })
    expect(down.quantity).toBe(8)
    let mv = getMovementsForProduct(db, p.id)[0]
    expect(mv.movementType).toBe('CORRECTION_DOWN')
    expect(mv.quantityChange).toBe(-2)
    expect(mv.balanceAfter).toBe(8)
    expect(mv.reason).toBe('جرد: تلف وحدتين')

    const up = correctStock(db, { productId: p.id, newQuantity: 12, reason: 'تصحيح جرد بالزيادة' })
    expect(up.quantity).toBe(12)
    mv = getMovementsForProduct(db, p.id)[0]
    expect(mv.movementType).toBe('CORRECTION_UP')
    expect(mv.quantityChange).toBe(4)
    expect(mv.balanceAfter).toBe(12)
  })

  it('prevents the stock from becoming negative', () => {
    const db = createTestDb()
    const p = createProduct(db, makeProductInput(db, { openingQuantity: 3 }))
    expect(() => correctStock(db, { productId: p.id, newQuantity: -1, reason: 'خطأ' })).toThrow(
      AppError
    )
    expect(getProduct(db, p.id)?.quantity).toBe(3)
  })

  it('rejects a no-op correction equal to current stock', () => {
    const db = createTestDb()
    const p = createProduct(db, makeProductInput(db, { openingQuantity: 10 }))
    expect(() =>
      correctStock(db, { productId: p.id, newQuantity: 10, reason: 'لا تغيير' })
    ).toThrow(AppError)
  })
})

describe('transactions: rollback on failure', () => {
  it('leaves balance and history unchanged when a movement insert fails', () => {
    const db = createTestDb()
    const p = createProduct(db, makeProductInput(db, { openingQuantity: 10 }))

    // Force a failure inside receiveStock's transaction: temporarily add a
    // trigger that rejects RECEIPT movements for this product.
    db.exec(`
      CREATE TRIGGER fail_receipt BEFORE INSERT ON stock_movements
      WHEN NEW.movement_type = 'RECEIPT' AND NEW.product_id = ${p.id}
      BEGIN SELECT RAISE(ABORT, 'test-forced-failure'); END;
    `)
    expect(() => receiveStock(db, { productId: p.id, quantity: 5 })).toThrow()
    db.exec('DROP TRIGGER fail_receipt')

    // Stock was NOT increased and NO partial movement exists.
    expect(getProduct(db, p.id)?.quantity).toBe(10)
    const movements = getMovementsForProduct(db, p.id)
    expect(movements).toHaveLength(1)
    expect(movements[0].movementType).toBe('OPENING')
  })

  it('rolls back the whole create when the OPENING movement fails', () => {
    const db = createTestDb()
    db.exec(`
      CREATE TRIGGER fail_opening BEFORE INSERT ON stock_movements
      WHEN NEW.movement_type = 'OPENING'
      BEGIN SELECT RAISE(ABORT, 'test-forced-failure'); END;
    `)
    expect(() =>
      createProduct(db, makeProductInput(db, { code: 'RB-1', openingQuantity: 10 }))
    ).toThrow()
    db.exec('DROP TRIGGER fail_opening')
    // No orphan product row survived the failed transaction.
    expect(getProduct(db, 1)).toBeNull()
    expect(listProducts(db, { includeInactive: true })).toHaveLength(0)
  })
})

describe('search & filters', () => {
  it('filters by search text and category', () => {
    const db = createTestDb()
    const clothes = categoryIdByName(db, 'الملابس الرياضية')
    createProduct(
      db,
      makeProductInput(db, { code: 'S-1', name: 'قميص رياضي', categoryId: clothes })
    )
    createProduct(db, makeProductInput(db, { code: 'S-2', name: 'قفاز حارس مرمى' }))
    expect(listProducts(db, { search: 'قفاز' })).toHaveLength(1)
    expect(listProducts(db, { search: 'S-1' })).toHaveLength(1)
    expect(listProducts(db, { categoryId: clothes })).toHaveLength(1)
    // Wildcards in user input are escaped, not treated as patterns.
    expect(listProducts(db, { search: '%' })).toHaveLength(0)
  })
})

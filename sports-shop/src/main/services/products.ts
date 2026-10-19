/**
 * Product service — all product & stock business logic, SQLite only.
 *
 * Design notes:
 *  - Every function receives the Database connection as first argument so it
 *    can be unit-tested against in-memory / temp-file databases without
 *    Electron.
 *  - Stock-changing operations (create with opening stock, receive, correct)
 *    run inside db.transaction(): the product row update and the movement
 *    history insert either both happen or neither does.
 *  - Negative stock is prevented twice: an explicit pre-check inside the
 *    transaction AND SQLite CHECK constraints on the columns.
 *  - Deletion is never destructive: products are deactivated instead
 *    (they may carry movement history).
 */

import type Database from 'better-sqlite3'
import {
  AppError,
  type Category,
  type CorrectStockInput,
  type Product,
  type ProductInput,
  type ProductListOptions,
  type ProductUpdate,
  type ReceiveStockInput,
  type StockMovement,
  type StockMovementWithProduct
} from '../../shared/types'
import {
  nonNegativeInt,
  optionalText,
  positiveInt,
  requireBoolean,
  requireReason,
  requireString
} from './validation'

// Row <-> entity mapping ------------------------------------------------------

interface ProductRow {
  id: number
  code: string
  name: string
  category_id: number
  size: string | null
  color: string | null
  material: string | null
  purchase_price: number
  sale_price: number
  external_price: number
  quantity: number
  min_stock: number
  supplier_ref: string | null
  active: number
  created_at: string
  updated_at: string
}

function mapProduct(r: ProductRow): Product {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    categoryId: r.category_id,
    size: r.size,
    color: r.color,
    material: r.material,
    purchasePrice: r.purchase_price,
    salePrice: r.sale_price,
    externalPrice: r.external_price,
    quantity: r.quantity,
    minStock: r.min_stock,
    supplierRef: r.supplier_ref,
    active: r.active === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

const SELECT_PRODUCT = `SELECT id, code, name, category_id, size, color, material,
  purchase_price, sale_price, external_price, quantity, min_stock, supplier_ref,
  active, created_at, updated_at FROM products`

// Categories -------------------------------------------------------------------

export function listCategories(db: Database.Database): Category[] {
  const rows = db
    .prepare('SELECT id, name, created_at FROM categories ORDER BY id')
    .all() as Array<{ id: number; name: string; created_at: string }>
  return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }))
}

function assertCategoryExists(db: Database.Database, categoryId: number): void {
  const found = db.prepare('SELECT 1 FROM categories WHERE id = ?').get(categoryId)
  if (!found) throw new AppError('VALIDATION', 'الفئة المحددة غير موجودة')
}

// Validation of DTOs -----------------------------------------------------------

function validateProductCommon(input: {
  code: unknown
  name: unknown
  categoryId: unknown
  size?: unknown
  color?: unknown
  material?: unknown
  purchasePrice: unknown
  salePrice: unknown
  externalPrice: unknown
  minStock: unknown
  supplierRef?: unknown
}): {
  code: string
  name: string
  categoryId: number
  size: string | null
  color: string | null
  material: string | null
  purchasePrice: number
  salePrice: number
  externalPrice: number
  minStock: number
  supplierRef: string | null
} {
  const code = requireString(input.code, 'رمز المنتج (SKU)', 60)
  const name = requireString(input.name, 'اسم المنتج')
  const categoryId = nonNegativeInt(input.categoryId, 'الفئة')
  const size = optionalText(input.size, 'المقاس', 50)
  const color = optionalText(input.color, 'اللون', 50)
  const material = optionalText(input.material, 'المادة/النوع', 100)
  const purchasePrice = nonNegativeInt(input.purchasePrice, 'سعر الشراء')
  const salePrice = nonNegativeInt(input.salePrice, 'سعر البيع')
  const externalPrice = nonNegativeInt(input.externalPrice, 'سعر البيع الخارجي')
  const minStock = nonNegativeInt(input.minStock, 'حد التنبيه للمخزون')
  const supplierRef = optionalText(input.supplierRef, 'مرجع المورد', 120)
  return {
    code,
    name,
    categoryId,
    size,
    color,
    material,
    purchasePrice,
    salePrice,
    externalPrice,
    minStock,
    supplierRef
  }
}

function assertCodeAvailable(db: Database.Database, code: string, excludeId?: number): void {
  const existing = excludeId
    ? db.prepare('SELECT id FROM products WHERE code = ? AND id != ?').get(code, excludeId)
    : db.prepare('SELECT id FROM products WHERE code = ?').get(code)
  if (existing) throw new AppError('DUPLICATE_CODE', `رمز المنتج «${code}» مستعمل من قبل صنف آخر`)
}

// Reads ------------------------------------------------------------------------

export function listProducts(
  db: Database.Database,
  options: ProductListOptions = {}
): Array<Product & { categoryName: string }> {
  const search = typeof options.search === 'string' ? options.search.trim() : ''
  const params: unknown[] = []
  let sql = `SELECT p.*, c.name AS category_name FROM products p
             JOIN categories c ON c.id = p.category_id`
  const where: string[] = []
  if (search) {
    where.push('(p.name LIKE ? OR p.code LIKE ?)')
    const like = `%${search.replace(/[%_]/g, (m) => '\\' + m)}%`
    params.push(like, like)
  }
  if (options.categoryId !== undefined && options.categoryId !== null) {
    where.push('p.category_id = ?')
    params.push(nonNegativeInt(options.categoryId, 'الفئة'))
  }
  if (!options.includeInactive) where.push('p.active = 1')
  if (where.length) sql += ' WHERE ' + where.join(' AND ')
  sql += ' ORDER BY p.name COLLATE NOCASE'

  const rows = db.prepare(sql).all(...params) as ProductRow[] & Array<{ category_name: string }>
  return rows.map((r) => ({ ...mapProduct(r), categoryName: (r as { category_name: string }).category_name }))
}

export function getProduct(db: Database.Database, id: number): Product | null {
  const row = db.prepare(`${SELECT_PRODUCT} WHERE id = ?`).get(id) as ProductRow | undefined
  return row ? mapProduct(row) : null
}

export function getMovementsForProduct(
  db: Database.Database,
  productId: number,
  limit = 200
): StockMovement[] {
  const rows = db
    .prepare(
      `SELECT id, product_id, movement_type, quantity_change, balance_after, reason, created_at
       FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(productId, limit) as Array<{
    id: number
    product_id: number
    movement_type: StockMovement['movementType']
    quantity_change: number
    balance_after: number
    reason: string | null
    created_at: string
  }>
  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    movementType: r.movement_type,
    quantityChange: r.quantity_change,
    balanceAfter: r.balance_after,
    reason: r.reason,
    createdAt: r.created_at
  }))
}

export function getAllMovements(db: Database.Database, limit = 500): StockMovementWithProduct[] {
  const rows = db
    .prepare(
      `SELECT m.id, m.product_id, m.movement_type, m.quantity_change, m.balance_after,
              m.reason, m.created_at, p.code AS product_code, p.name AS product_name
       FROM stock_movements m JOIN products p ON p.id = m.product_id
       ORDER BY m.id DESC LIMIT ?`
    )
    .all(limit) as Array<{
    id: number
    product_id: number
    movement_type: StockMovement['movementType']
    quantity_change: number
    balance_after: number
    reason: string | null
    created_at: string
    product_code: string
    product_name: string
  }>
  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    movementType: r.movement_type,
    quantityChange: r.quantity_change,
    balanceAfter: r.balance_after,
    reason: r.reason,
    createdAt: r.created_at,
    productCode: r.product_code,
    productName: r.product_name
  }))
}

// Writes -----------------------------------------------------------------------

/**
 * Creates a product and records its opening stock as an audited OPENING
 * movement — both inside one transaction.
 */
export function createProduct(db: Database.Database, input: ProductInput): Product {
  const v = validateProductCommon(input)
  const openingQuantity = nonNegativeInt(input.openingQuantity, ' رصيد المخزون الافتتاحي')
  assertCategoryExists(db, v.categoryId)

  const create = db.transaction((): Product => {
    assertCodeAvailable(db, v.code)
    const info = db
      .prepare(
        `INSERT INTO products (code, name, category_id, size, color, material,
           purchase_price, sale_price, external_price, quantity, min_stock, supplier_ref, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
      )
      .run(
        v.code,
        v.name,
        v.categoryId,
        v.size,
        v.color,
        v.material,
        v.purchasePrice,
        v.salePrice,
        v.externalPrice,
        openingQuantity,
        v.minStock,
        v.supplierRef
      )
    const id = Number(info.lastInsertRowid)
    if (openingQuantity > 0) {
      recordMovement(db, id, 'OPENING', openingQuantity, openingQuantity, 'رصيد افتتاحي عند الإنشاء')
    }
    const p = getProduct(db, id)
    if (!p) throw new AppError('DB_ERROR', 'تعذّر قراءة المنتج بعد إنشائه')
    return p
  })
  return create()
}

/** Updates product data. Stock quantity is NOT editable here by design. */
export function updateProduct(db: Database.Database, input: ProductUpdate): Product {
  const v = validateProductCommon(input)
  const active = requireBoolean(input.active, 'حالة تفعيل المنتج')
  const existing = getProduct(db, input.id)
  if (!existing) throw new AppError('NOT_FOUND', 'المنتج غير موجود')
  assertCategoryExists(db, v.categoryId)

  const update = db.transaction(() => {
    assertCodeAvailable(db, v.code, input.id)
    db.prepare(
      `UPDATE products SET code = ?, name = ?, category_id = ?, size = ?, color = ?,
        material = ?, purchase_price = ?, sale_price = ?, external_price = ?, min_stock = ?,
        supplier_ref = ?, active = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      v.code,
      v.name,
      v.categoryId,
      v.size,
      v.color,
      v.material,
      v.purchasePrice,
      v.salePrice,
      v.externalPrice,
      v.minStock,
      v.supplierRef,
      active ? 1 : 0,
      input.id
    )
  })
  update()
  const p = getProduct(db, input.id)
  if (!p) throw new AppError('DB_ERROR', 'تعذّر قراءة المنتج بعد تعديله')
  return p
}

/** Receives a batch for an EXISTING product (never creates duplicates). */
export function receiveStock(db: Database.Database, input: ReceiveStockInput): Product {
  const quantity = positiveInt(input.quantity, 'كمية الدفعة')
  const reason = optionalText(input.reason, 'ملاحظة', 500)

  const tx = db.transaction((): Product => {
    const current = lockAndGetQuantity(db, input.productId)
    const next = current + quantity
    applyQuantity(db, input.productId, next)
    recordMovement(db, input.productId, 'RECEIPT', quantity, next, reason ?? 'استلام دفعة جديدة')
    const p = getProduct(db, input.productId)
    if (!p) throw new AppError('DB_ERROR', 'تعذّر قراءة المنتج بعد الاستلام')
    return p
  })
  return tx()
}

/**
 * Authorized stock correction: caller provides the new physical count; the
 * signed difference and the CORRECTION_UP/DOWN movement are computed here.
 * A reason is mandatory. Negative results are impossible by validation and
 * by CHECK constraint.
 */
export function correctStock(db: Database.Database, input: CorrectStockInput): Product {
  const newQuantity = nonNegativeInt(input.newQuantity, 'الكمية الجديدة')
  const reason = requireReason(input.reason)

  const tx = db.transaction((): Product => {
    const current = lockAndGetQuantity(db, input.productId)
    if (newQuantity === current) {
      throw new AppError('VALIDATION', 'الكمية الجديدة تساوي الكمية الحالية — لا حاجة لتصحيح')
    }
    applyQuantity(db, input.productId, newQuantity)
    const delta = newQuantity - current
    recordMovement(
      db,
      input.productId,
      delta > 0 ? 'CORRECTION_UP' : 'CORRECTION_DOWN',
      delta,
      newQuantity,
      reason
    )
    const p = getProduct(db, input.productId)
    if (!p) throw new AppError('DB_ERROR', 'تعذّر قراءة المنتج بعد التصحيح')
    return p
  })
  return tx()
}

// Internal helpers ---------------------------------------------------------------

/** Reads the product inside the active transaction; throws if missing. */
function lockAndGetQuantity(db: Database.Database, productId: number): number {
  nonNegativeInt(productId, 'معرف المنتج')
  const row = db.prepare('SELECT quantity FROM products WHERE id = ?').get(productId) as
    | { quantity: number }
    | undefined
  if (!row) throw new AppError('NOT_FOUND', 'المنتج غير موجود')
  return row.quantity
}

function applyQuantity(db: Database.Database, productId: number, next: number): void {
  if (!Number.isInteger(next) || next < 0) {
    throw new AppError('NEGATIVE_STOCK', 'عملية مرفوضة: لا يمكن أن تصبح كمية المخزون سالبة')
  }
  db.prepare(`UPDATE products SET quantity = ?, updated_at = datetime('now') WHERE id = ?`).run(
    next,
    productId
  )
}

function recordMovement(
  db: Database.Database,
  productId: number,
  type: StockMovement['movementType'],
  change: number,
  balanceAfter: number,
  reason: string | null
): void {
  db.prepare(
    `INSERT INTO stock_movements (product_id, movement_type, quantity_change, balance_after, reason)
     VALUES (?, ?, ?, ?, ?)`
  ).run(productId, type, change, balanceAfter, reason)
}

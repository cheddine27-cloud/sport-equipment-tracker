import type Database from 'better-sqlite3'

/**
 * Unified movement recorder. Since schema v2 all NEW movements are written to
 * `stock_movements_v2` (which understands SALE / SALE_CANCEL / RETURN /
 * PURCHASE types and carries audit references). The legacy `stock_movements`
 * table remains read-only history for rows created before v2.
 */
export interface MovementRecord {
  productId: number
  movementType: string
  quantityChange: number
  balanceAfter: number
  reason: string | null
  refType?: string | null
  refId?: number | null
}

export function recordMovementV2(db: Database.Database, m: MovementRecord): void {
  db.prepare(
    `INSERT INTO stock_movements_v2
       (product_id, movement_type, quantity_change, balance_after, reason, ref_type, ref_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(m.productId, m.movementType, m.quantityChange, m.balanceAfter, m.reason, m.refType ?? null, m.refId ?? null)
}

const LEGACY_TYPES = new Set(['OPENING', 'RECEIPT', 'CORRECTION_UP', 'CORRECTION_DOWN'])

interface RawMovement {
  id: number
  product_id: number
  movement_type: string
  quantity_change: number
  balance_after: number
  reason: string | null
  created_at: string
}

function mapRow(r: RawMovement) {
  return {
    id: r.id,
    productId: r.product_id,
    movementType: r.movement_type as never,
    quantityChange: r.quantity_change,
    balanceAfter: r.balance_after,
    reason: r.reason,
    createdAt: r.created_at
  }
}

/** Movements for one product across BOTH tables, most recent first. */
export function movementsForProduct(db: Database.Database, productId: number, limit = 200): ReturnType<typeof mapRow>[] {
  const legacy = db
    .prepare(
      `SELECT id, product_id, movement_type, quantity_change, balance_after, reason, created_at
       FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(productId, limit) as RawMovement[]
  const modern = db
    .prepare(
      `SELECT id, product_id, movement_type, quantity_change, balance_after, reason, created_at
       FROM stock_movements_v2 WHERE product_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(productId, limit) as RawMovement[]
  return [...legacy, ...modern].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id)).slice(0, limit).map(mapRow)
}

/** Recent movements across all products from both tables (inventory view). */
export function movementsAll(db: Database.Database, limit = 500): Array<ReturnType<typeof mapRow> & { productCode: string; productName: string }> {
  const sql = (table: string): string => `
    SELECT m.id, m.product_id, m.movement_type, m.quantity_change, m.balance_after,
           m.reason, m.created_at, p.code AS product_code, p.name AS product_name
    FROM ${table} m JOIN products p ON p.id = m.product_id`
  const legacy = db.prepare(`${sql('stock_movements')} ORDER BY m.id DESC LIMIT ?`).all(limit) as Array<RawMovement & { product_code: string; product_name: string }>
  const modern = db.prepare(`${sql('stock_movements_v2')} ORDER BY m.id DESC LIMIT ?`).all(limit) as Array<RawMovement & { product_code: string; product_name: string }>
  const merged = [...legacy, ...modern]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id))
    .slice(0, limit)
  return merged.map((r) => ({ ...mapRow(r), productCode: r.product_code, productName: r.product_name }))
}

/** True if the given movement type exists only in the v2 vocabulary. */
export const isV2OnlyType = (t: string): boolean => !LEGACY_TYPES.has(t)

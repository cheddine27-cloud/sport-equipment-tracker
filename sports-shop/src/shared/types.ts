/**
 * Domain types shared between the main process (SQLite layer), the preload
 * bridge and the renderer UI. All monetary amounts are INTEGER Algerian
 * dinars (دج) — never floats — to avoid rounding errors.
 */

// ---------------------------------------------------------------------------
// Entities (mirror the SQLite tables created by the migrations)
// ---------------------------------------------------------------------------

export interface Category {
  id: number
  /** Arabic display name, e.g. «الملابس الرياضية». */
  name: string
  createdAt: string
}

export interface Product {
  id: number
  /** Unique product code / SKU. */
  code: string
  name: string
  categoryId: number
  /** Optional size — may stay empty. */
  size: string | null
  color: string | null
  material: string | null
  /** Purchase cost per unit, integer DZD ≥ 0. */
  purchasePrice: number
  /** In-store selling price, integer DZD ≥ 0. */
  salePrice: number
  /** External/online selling price, integer DZD ≥ 0. */
  externalPrice: number
  /** Current physical stock quantity (integer ≥ 0). */
  quantity: number
  /** Minimum stock threshold (integer ≥ 0). */
  minStock: number
  /** Free-text supplier reference (the supplier module comes later). */
  supplierRef: string | null
  active: boolean
  createdAt: string
  updatedAt: string
}

/** Movement type codes stored in `stock_movements.movement_type`. */
export type StockMovementType = 'OPENING' | 'RECEIPT' | 'CORRECTION_UP' | 'CORRECTION_DOWN'

export interface StockMovement {
  id: number
  productId: number
  movementType: StockMovementType
  /** Signed change applied to the stock (negative for CORRECTION_DOWN). */
  quantityChange: number
  /** Stock of the product immediately after this movement. */
  balanceAfter: number
  reason: string | null
  createdAt: string
}

/** Joined row used by the inventory history screen. */
export interface StockMovementWithProduct extends StockMovement {
  productCode: string
  productName: string
}

// ---------------------------------------------------------------------------
// Input DTOs (what the renderer is allowed to send over IPC)
// ---------------------------------------------------------------------------

export interface ProductInput {
  code: string
  name: string
  categoryId: number
  size?: string | null
  color?: string | null
  material?: string | null
  purchasePrice: number
  salePrice: number
  externalPrice: number
  /** Opening stock recorded at creation time (≥ 0). */
  openingQuantity: number
  minStock: number
  supplierRef?: string | null
}

export interface ProductUpdate {
  id: number
  code: string
  name: string
  categoryId: number
  size?: string | null
  color?: string | null
  material?: string | null
  purchasePrice: number
  salePrice: number
  externalPrice: number
  minStock: number
  supplierRef?: string | null
  active: boolean
  /** NOTE: there is intentionally no `quantity` field — stock changes only
   * through audited movements (receiveStock / correctStock). */
}

export interface ReceiveStockInput {
  productId: number
  /** Batch size, positive integer. */
  quantity: number
  reason?: string | null
}

export interface CorrectStockInput {
  productId: number
  /** New authorized physical count (non-negative integer). The main process
   * computes the signed difference itself; the renderer cannot forge it. */
  newQuantity: number
  /** Mandatory justification for the correction. */
  reason: string
}

export interface ProductListOptions {
  search?: string
  categoryId?: number | null
  includeInactive?: boolean
}

// ---------------------------------------------------------------------------
// Structured result envelope returned by every business IPC call
// ---------------------------------------------------------------------------

/** Stable, machine-readable error codes (UI maps them to Arabic messages). */
export type AppErrorCode =
  'VALIDATION' | 'DUPLICATE_CODE' | 'NOT_FOUND' | 'NEGATIVE_STOCK' | 'DB_ERROR'

export type IpcResult<T> =
  { ok: true; data: T } | { ok: false; code: AppErrorCode; message: string }

/** Thrown inside the main process; converted to an IpcResult at the IPC edge. */
export class AppError extends Error {
  readonly code: AppErrorCode
  constructor(code: AppErrorCode, message: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
  }
}

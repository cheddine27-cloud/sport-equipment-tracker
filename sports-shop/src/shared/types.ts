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

// ---------------------------------------------------------------------------
// Sales, returns, purchases, customers, suppliers, expenses, orders (v2–v5)
// ---------------------------------------------------------------------------

export type PaymentMethod = 'CASH' | 'CARD'
export type SaleStatus = 'COMPLETED' | 'CANCELLED'

export interface SaleLineInput {
  productId: number
  quantity: number
  /** Unit price in integer DZD (defaults to the product sale price in UI). */
  unitPrice: number
}

export interface SaleInput {
  lines: SaleLineInput[]
  /** Total discount in integer DZD, 0 ≤ discount ≤ subtotal. */
  discount: number
  paid: number
  paymentMethod: PaymentMethod
  customerName?: string | null
  note?: string | null
}

export interface SaleItem {
  id: number
  saleId: number
  productId: number
  productCode: string
  productName: string
  quantity: number
  unitPrice: number
  purchasePrice: number
  returnedQty: number
}

export interface Sale {
  id: number
  invoiceNo: string
  subtotal: number
  discount: number
  total: number
  paid: number
  balance: number
  paymentMethod: PaymentMethod
  status: SaleStatus
  cancelledAt: string | null
  cancelReason: string | null
  note: string | null
  customerId: number | null
  customerName: string | null
  createdAt: string
  items: SaleItem[]
}

export interface ReturnInput {
  saleId: number
  saleItemId: number
  quantity: number
  reason: string
}

export interface ReturnRecord {
  id: number
  returnNo: string
  saleId: number
  saleItemId: number
  quantity: number
  amountRefunded: number
  reason: string
  createdAt: string
}

export interface CustomerInput {
  name: string
  phone?: string | null
  address?: string | null
  note?: string | null
}

export interface Customer extends Required<Omit<CustomerInput, 'name'>> {
  id: number
  name: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface PartyBalance {
  partyId: number
  name: string
  totalBilled: number
  totalPaid: number
  /** outstanding = billed − paid (customers); owed-to-supplier for suppliers. */
  outstanding: number
}

export interface PurchaseLineInput {
  productId: number
  quantity: number
  unitCost: number
}

export interface PurchaseInput {
  supplierId?: number | null
  supplierName?: string | null
  lines: PurchaseLineInput[]
  paid: number
  note?: string | null
}

export interface PurchaseItem {
  id: number
  purchaseId: number
  productId: number
  productCode: string
  productName: string
  quantity: number
  unitCost: number
}

export interface Purchase {
  id: number
  receiptNo: string
  supplierId: number | null
  supplierName: string
  total: number
  paid: number
  note: string | null
  createdAt: string
  items: PurchaseItem[]
}

export interface SupplierPaymentInput {
  purchaseId: number
  amount: number
  note?: string | null
}

export interface SupplierPayment {
  id: number
  purchaseId: number
  amount: number
  note: string | null
  createdAt: string
}

export interface ExpenseInput {
  categoryId: number
  amount: number
  description?: string | null
  /** ISO date YYYY-MM-DD. */
  spentOn: string
}

export interface Expense {
  id: number
  categoryId: number
  categoryName: string
  amount: number
  description: string | null
  spentOn: string
  createdAt: string
}

export interface ExpenseCategory {
  id: number
  name: string
}

export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED'

export interface OrderLineInput {
  productId: number
  quantity: number
  unitPrice: number
}

export interface OrderInput {
  customerName: string
  phone?: string | null
  address?: string | null
  note?: string | null
  lines: OrderLineInput[]
}

export interface OrderItem {
  id: number
  orderId: number
  productId: number
  productCode: string
  productName: string
  quantity: number
  unitPrice: number
}

export interface Order {
  id: number
  orderNo: string
  customerName: string
  phone: string | null
  address: string | null
  note: string | null
  status: OrderStatus
  /** 0/1 — whether stock was already deducted for this order (idempotency guard). */
  stockApplied: boolean
  createdAt: string
  updatedAt: string
  items: OrderItem[]
  total: number
}

export interface ShopSettings {
  shopName: string
  shopAddress: string
  shopPhone: string
  invoiceFooter: string
}

export interface AuditEntry {
  id: number
  action: string
  entity: string
  entityId: number | null
  details: string | null
  createdAt: string
}

export interface PriceHistoryEntry {
  id: number
  productId: number
  field: 'purchase_price' | 'sale_price' | 'external_price'
  oldValue: number
  newValue: number
  changedAt: string
}

/** Aggregated report figures — all values are integer DZD. */
export interface ReportSummary {
  from: string
  to: string
  revenue: number
  discounts: number
  refunds: number
  cancelledSalesTotal: number
  cashReceived: number
  receivables: number
  cogs: number
  grossProfit: number
  expensesTotal: number
  netProfit: number
  purchasesTotal: number
  salesCount: number
}

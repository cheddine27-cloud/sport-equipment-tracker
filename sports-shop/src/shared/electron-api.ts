import type {
  AuditEntry,
  Category,
  CorrectStockInput,
  Customer,
  CustomerInput,
  Expense,
  ExpenseCategory,
  ExpenseInput,
  IpcResult,
  Order,
  OrderInput,
  OrderStatus,
  PartyBalance,
  PriceHistoryEntry,
  Product,
  ProductInput,
  ProductListOptions,
  ProductUpdate,
  Purchase,
  PurchaseInput,
  ReceiveStockInput,
  ReportSummary,
  ReturnInput,
  ReturnRecord,
  Sale,
  SaleInput,
  ShopSettings,
  SupplierPayment,
  SupplierPaymentInput
} from './types'

/**
 * Contract for the API that the preload script exposes to the renderer via
 * contextBridge (`window.desktop`). The renderer must NEVER rely on Node.js
 * or Electron APIs directly — only on this explicitly defined surface.
 *
 * Every method maps to exactly one whitelisted ipcMain.handle channel in
 * `src/main/ipc.ts`. There is intentionally NO raw-SQL, generic-invoke or
 * filesystem method anywhere on this surface. All business calls return a
 * structured `IpcResult` so errors never cross the IPC boundary as throws.
 */

export interface BackupInfo {
  fileName: string
  sizeBytes: number
  createdAt: string
}

/** Joined product row (product + category name) used across views. */
export type ProductRow = Product & { categoryName: string }

/** Vocabulary of all audited stock movements (legacy + v2 tables merged). */
export type MovementType = string

export interface StockMovementView {
  id: number
  productId: number
  /** Raw SQLite value — see the UI label map for Arabic display. */
  /** Signed change applied to the stock. */
  quantityChange: number
  balanceAfter: number
  reason: string | null
  createdAt: string
}

/** Movement joined with product identity, for the inventory history view. */
export type MovementRow = StockMovementView & {
  productCode?: string
  productName?: string
}

export interface DesktopAPI {
  /** Read-only application metadata provided by the main process. */
  getAppMeta(): Promise<{ appVersion: string; offline: true }>

  categories: {
    list(): Promise<IpcResult<Category[]>>
  }

  products: {
    list(options?: ProductListOptions): Promise<IpcResult<ProductRow[]>>
    get(id: number): Promise<IpcResult<Product>>
    create(input: ProductInput): Promise<IpcResult<Product>>
    update(input: ProductUpdate): Promise<IpcResult<Product>>
  }

  stock: {
    receive(input: ReceiveStockInput): Promise<IpcResult<Product>>
    correct(input: CorrectStockInput): Promise<IpcResult<Product>>
    movementsForProduct(productId: number): Promise<IpcResult<StockMovementView[]>>
    movementsAll(): Promise<IpcResult<MovementRow[]>>
  }

  sales: {
    /** Records a completed sale transactionally (deducts stock once). */
    create(input: SaleInput): Promise<IpcResult<Sale>>
    list(search?: string): Promise<IpcResult<Sale[]>>
    get(id: number): Promise<IpcResult<Sale>>
    cancel(id: number, reason: string): Promise<IpcResult<Sale>>
    recordReturn(input: ReturnInput): Promise<IpcResult<{ sale: Sale; ret: ReturnRecord }>>
    returnsForSale(saleId: number): Promise<IpcResult<ReturnRecord[]>>
  }

  orders: {
    create(input: OrderInput): Promise<IpcResult<Order>>
    list(status?: OrderStatus | 'ALL'): Promise<IpcResult<Order[]>>
    get(id: number): Promise<IpcResult<Order>>
    setStatus(id: number, status: OrderStatus): Promise<IpcResult<Order>>
  }

  customers: {
    list(includeInactive?: boolean): Promise<IpcResult<Customer[]>>
    create(input: CustomerInput): Promise<IpcResult<Customer>>
    update(id: number, input: CustomerInput): Promise<IpcResult<Customer>>
    balances(): Promise<IpcResult<PartyBalance[]>>
  }

  suppliers: {
    list(includeInactive?: boolean): Promise<IpcResult<Customer[]>>
    create(input: CustomerInput): Promise<IpcResult<Customer>>
    /** Per-purchase remaining debt across recent purchases. */
    purchaseBalances(): Promise<
      IpcResult<
        Array<{
          purchaseId: number
          receiptNo: string
          supplierName: string
          total: number
          paid: number
          remaining: number
          createdAt: string
        }>
      >
    >
  }

  purchases: {
    create(input: PurchaseInput): Promise<IpcResult<Purchase>>
    list(limit?: number): Promise<IpcResult<Purchase[]>>
    get(id: number): Promise<IpcResult<Purchase>>
    pay(input: SupplierPaymentInput): Promise<IpcResult<SupplierPayment>>
    payments(purchaseId: number): Promise<IpcResult<SupplierPayment[]>>
  }

  expenses: {
    categories(): Promise<IpcResult<ExpenseCategory[]>>
    addCategory(name: string): Promise<IpcResult<ExpenseCategory>>
    create(input: ExpenseInput): Promise<IpcResult<Expense>>
    list(from?: string, to?: string): Promise<IpcResult<Expense[]>>
  }

  reports: {
    summary(from: string, to: string): Promise<IpcResult<ReportSummary>>
    daily(from: string, to: string): Promise<IpcResult<DailyReportRow[]>>
    monthly(from: string, to: string): Promise<IpcResult<MonthlyReportRow[]>>
  }

  settings: {
    getShop(): Promise<IpcResult<ShopSettings>>
    setShop(input: Partial<ShopSettings>): Promise<IpcResult<ShopSettings>>
    priceHistory(productId: number): Promise<IpcResult<PriceHistoryEntry[]>>
    auditLog(): Promise<IpcResult<AuditEntry[]>>
  }

  backup: {
    create(label?: string): Promise<IpcResult<BackupInfo>>
    list(): Promise<IpcResult<BackupInfo[]>>
    validate(fileName: string): Promise<IpcResult<{ schemaVersion: number }>>
    restore(fileName: string): Promise<IpcResult<BackupInfo>>
  }
}

export interface DailyReportRow {
  day: string
  revenue: number
  discount: number
  paid: number
  count: number
  cogs: number
}

export interface MonthlyReportRow {
  month: string
  revenue: number
  discount: number
  paid: number
  count: number
  cogs: number
  expenses: number
}

/** Channel names — single source of truth, used by main and preload. */
export const IPC_CHANNELS = {
  appMeta: 'app:meta',
  categoriesList: 'categories:list',

  productsList: 'products:list',
  productGet: 'products:get',
  productCreate: 'products:create',
  productUpdate: 'products:update',

  stockReceive: 'stock:receive',
  stockCorrect: 'stock:correct',
  movementsForProduct: 'movements:forProduct',
  movementsAll: 'movements:all',

  saleCreate: 'sales:create',
  saleList: 'sales:list',
  saleGet: 'sales:get',
  saleCancel: 'sales:cancel',
  saleReturn: 'sales:return',
  saleReturns: 'sales:returns',

  orderCreate: 'orders:create',
  orderList: 'orders:list',
  orderGet: 'orders:get',
  orderSetStatus: 'orders:setStatus',

  customerList: 'customers:list',
  customerCreate: 'customers:create',
  customerUpdate: 'customers:update',
  customerBalances: 'customers:balances',

  supplierList: 'suppliers:list',
  supplierCreate: 'suppliers:create',
  supplierPurchaseBalances: 'suppliers:purchaseBalances',

  purchaseCreate: 'purchases:create',
  purchaseList: 'purchases:list',
  purchaseGet: 'purchases:get',
  purchasePay: 'purchases:pay',
  purchasePayments: 'purchases:payments',

  expenseCategories: 'expenses:categories',
  expenseAddCategory: 'expenses:addCategory',
  expenseCreate: 'expenses:create',
  expenseList: 'expenses:list',

  reportSummary: 'reports:summary',
  reportDaily: 'reports:daily',
  reportMonthly: 'reports:monthly',

  settingsGet: 'settings:getShop',
  settingsSet: 'settings:setShop',
  priceHistory: 'settings:priceHistory',
  auditLog: 'settings:auditLog',

  backupCreate: 'backup:create',
  backupList: 'backup:list',
  backupValidate: 'backup:validate',
  backupRestore: 'backup:restore'
} as const

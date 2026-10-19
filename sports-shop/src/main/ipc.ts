import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../shared/electron-api'
import { AppError, type IpcResult } from '../shared/types'
import { getDb } from './db'
import * as products from './services/products'
import * as movements from './services/movements'
import * as sales from './services/sales'
import * as orders from './services/orders'
import * as parties from './services/parties'
import * as purchases from './services/purchases'
import * as expenses from './services/expenses'
import * as reports from './services/reports'
import * as settings from './services/settings'
import * as audit from './services/audit'
import * as backup from './services/backup'
import type {
  CorrectStockInput,
  CustomerInput,
  ExpenseInput,
  OrderInput,
  OrderStatus,
  ProductInput,
  ProductListOptions,
  ProductUpdate,
  PurchaseInput,
  ReceiveStockInput,
  ReturnInput,
  SaleInput,
  ShopSettings,
  SupplierPaymentInput
} from '../shared/types'

/**
 * Registers the business IPC handlers. This module is the ONLY place where
 * DB services meet IPC. Rules enforced here:
 *  - Handlers accept exactly ONE plain-object/primitive argument.
 *  - Every payload is validated in the services layer (trusted main process).
 *  - Nothing is ever thrown across the IPC boundary: results come back as a
 *    structured `IpcResult` ({ ok, data } | { ok:false, code, message }).
 *    Unexpected errors are logged in main but only a generic Arabic message
 *    crosses to the renderer — no stack traces or local paths leak.
 *  - No raw SQL, no generic invoke, no filesystem access is exposed.
 */

/** Wraps a sync service call into a safe structured result. */
function safe<T>(fn: () => T): IpcResult<T> {
  try {
    return { ok: true, data: fn() }
  } catch (err) {
    if (err instanceof AppError) return { ok: false, code: err.code, message: err.message }
    console.error('Unexpected IPC error:', err)
    return { ok: false, code: 'DB_ERROR', message: 'خطأ غير متوقع أثناء تنفيذ العملية' }
  }
}

/** Wraps an async service call (e.g. SQLite online backup). */
async function safeAsync<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    if (err instanceof AppError) return { ok: false, code: err.code, message: err.message }
    console.error('Unexpected IPC error:', err)
    return { ok: false, code: 'DB_ERROR', message: 'خطأ غير متوقع أثناء تنفيذ العملية' }
  }
}

/** Guards against non-object payloads arriving over IPC. */
function expectObject(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new AppError('VALIDATION', 'صيغة البيانات المرسلة غير صحيحة')
  }
  return payload as Record<string, unknown>
}

/** Positive-integer id guard shared by all "get by id" channels. */
function expectId(value: unknown, label = 'المعرف'): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new AppError('VALIDATION', `${label} غير صالح`)
  }
  return value
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new AppError('VALIDATION', `${label} غير صالح`)
  return value
}

function expectOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function expectDate(value: unknown, label: string): string {
  const s = expectString(value, label)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new AppError('VALIDATION', `${label} يجب أن يكون بتاريخ صحيح`)
  return s
}

const ORDER_STATUSES: OrderStatus[] = ['PENDING', 'CONFIRMED', 'DISPATCHED', 'DELIVERED', 'CANCELLED']

let registered = false

export function registerBusinessIpcHandlers(): void {
  // Register each handler exactly once (hot-reload safety).
  if (registered) return
  registered = true

  const on = <A extends unknown[], T>(channel: string, handler: (...args: A) => T): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, (_e, ...args: unknown[]) => safe(() => handler(...(args as A))))
  }
  const onAsync = <A extends unknown[], T>(
    channel: string,
    handler: (...args: A) => Promise<T>
  ): void => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (_e, ...args: unknown[]) =>
      safeAsync(() => handler(...(args as A)))
    )
  }

  // ---- Categories & products -------------------------------------------------
  on(IPC_CHANNELS.categoriesList, () => products.listCategories(getDb()))
  on(IPC_CHANNELS.productsList, (options: ProductListOptions) =>
    products.listProducts(getDb(), options ?? {})
  )
  on(IPC_CHANNELS.productGet, (id: number) => {
    const p = products.getProduct(getDb(), expectId(id, 'معرف المنتج'))
    if (!p) throw new AppError('NOT_FOUND', 'المنتج غير موجود')
    return p
  })
  on(IPC_CHANNELS.productCreate, (input: ProductInput) => products.createProduct(getDb(), input))
  on(IPC_CHANNELS.productUpdate, (input: ProductUpdate) => products.updateProduct(getDb(), input))

  // ---- Stock -------------------------------------------------------------------
  on(IPC_CHANNELS.stockReceive, (input: ReceiveStockInput) =>
    products.receiveStock(getDb(), input)
  )
  on(IPC_CHANNELS.stockCorrect, (input: CorrectStockInput) =>
    products.correctStock(getDb(), input)
  )
  on(IPC_CHANNELS.movementsForProduct, (productId: number) =>
    movements.movementsForProduct(getDb(), expectId(productId, 'معرف المنتج'))
  )
  on(IPC_CHANNELS.movementsAll, () => movements.movementsAll(getDb()))

  // ---- Sales ---------------------------------------------------------------------
  on(IPC_CHANNELS.saleCreate, (input: SaleInput) => sales.createSale(getDb(), input))
  on(IPC_CHANNELS.saleList, (search: string) => sales.listSales(getDb(), search ?? ''))
  on(IPC_CHANNELS.saleGet, (id: number) => {
    const s = sales.getSale(getDb(), expectId(id, 'معرف الفاتورة'))
    if (!s) throw new AppError('NOT_FOUND', 'الفاتورة غير موجودة')
    return s
  })
  on(IPC_CHANNELS.saleCancel, (id: number, reason: string) =>
    sales.cancelSale(getDb(), expectId(id, 'معرف الفاتورة'), expectString(reason, 'السبب'))
  )
  on(IPC_CHANNELS.saleReturn, (input: ReturnInput) => {
    const r = sales.recordReturn(getDb(), input)
    return { sale: r.sale, ret: r.ret }
  })
  on(IPC_CHANNELS.saleReturns, (saleId: number) =>
    sales.listReturnsForSale(getDb(), expectId(saleId, 'معرف الفاتورة'))
  )

  // ---- Orders ----------------------------------------------------------------------
  on(IPC_CHANNELS.orderCreate, (input: OrderInput) => orders.createOrder(getDb(), input))
  on(IPC_CHANNELS.orderList, (status: OrderStatus | 'ALL') => {
    const st =
      status === undefined || status === 'ALL'
        ? ('ALL' as const)
        : (() => {
            if (!ORDER_STATUSES.includes(status)) {
              throw new AppError('VALIDATION', 'حالة الطلب غير معروفة')
            }
            return status
          })()
    return orders.listOrders(getDb(), st)
  })
  on(IPC_CHANNELS.orderGet, (id: number) => {
    const o = orders.getOrder(getDb(), expectId(id, 'معرف الطلب'))
    if (!o) throw new AppError('NOT_FOUND', 'الطلب غير موجود')
    return o
  })
  on(IPC_CHANNELS.orderSetStatus, (id: number, status: OrderStatus) => {
    if (!ORDER_STATUSES.includes(status)) throw new AppError('VALIDATION', 'حالة الطلب غير معروفة')
    return orders.setOrderStatus(getDb(), expectId(id, 'معرف الطلب'), status)
  })

  // ---- Customers & suppliers ---------------------------------------------------------
  on(IPC_CHANNELS.customerList, (includeInactive: boolean) =>
    parties.listCustomers(getDb(), includeInactive === true)
  )
  on(IPC_CHANNELS.customerCreate, (input: CustomerInput) => parties.createCustomer(getDb(), input))
  on(IPC_CHANNELS.customerUpdate, (id: number, input: CustomerInput) =>
    parties.updateCustomer(getDb(), expectId(id, 'معرف الزبون'), input)
  )
  on(IPC_CHANNELS.customerBalances, () => parties.customerBalances(getDb()))
  on(IPC_CHANNELS.supplierList, (includeInactive: boolean) =>
    parties.listSuppliers(getDb(), includeInactive === true)
  )
  on(IPC_CHANNELS.supplierCreate, (input: CustomerInput) => parties.createSupplier(getDb(), input))
  on(IPC_CHANNELS.supplierPurchaseBalances, () => parties.supplierPurchaseBalances(getDb()))

  // ---- Purchases -------------------------------------------------------------------
  on(IPC_CHANNELS.purchaseCreate, (input: PurchaseInput) =>
    purchases.createPurchase(getDb(), input)
  )
  on(IPC_CHANNELS.purchaseList, (limit: number) =>
    purchases.listPurchases(getDb(), typeof limit === 'number' ? limit : 100)
  )
  on(IPC_CHANNELS.purchaseGet, (id: number) => {
    const p = purchases.getPurchase(getDb(), expectId(id, 'معرف سند الشراء'))
    if (!p) throw new AppError('NOT_FOUND', 'سند الشراء غير موجود')
    return p
  })
  on(IPC_CHANNELS.purchasePay, (input: SupplierPaymentInput) =>
    purchases.paySupplier(getDb(), input.purchaseId, input.amount, input.note ?? null)
  )
  on(IPC_CHANNELS.purchasePayments, (purchaseId: number) =>
    purchases.listSupplierPayments(getDb(), expectId(purchaseId, 'معرف سند الشراء'))
  )

  // ---- Expenses ---------------------------------------------------------------------
  on(IPC_CHANNELS.expenseCategories, () => expenses.listExpenseCategories(getDb()))
  on(IPC_CHANNELS.expenseAddCategory, (name: string) =>
    expenses.createExpenseCategory(getDb(), expectString(name, 'اسم الفئة'))
  )
  on(IPC_CHANNELS.expenseCreate, (input: ExpenseInput) => expenses.createExpense(getDb(), input))
  on(IPC_CHANNELS.expenseList, (from: string, to: string) =>
    expenses.listExpenses(getDb(), from ?? '', to ?? '')
  )

  // ---- Reports -----------------------------------------------------------------------
  on(IPC_CHANNELS.reportSummary, (from: string, to: string) =>
    reports.reportSummary(getDb(), expectDate(from, 'من تاريخ'), expectDate(to, 'إلى تاريخ'))
  )
  on(IPC_CHANNELS.reportDaily, (from: string, to: string) =>
    reports.dailySales(getDb(), expectDate(from, 'من تاريخ'), expectDate(to, 'إلى تاريخ'))
  )
  on(IPC_CHANNELS.reportMonthly, (from: string, to: string) =>
    reports.monthlySales(getDb(), expectDate(from, 'من تاريخ'), expectDate(to, 'إلى تاريخ'))
  )

  // ---- Settings / price history / audit ----------------------------------------------
  on(IPC_CHANNELS.settingsGet, () => settings.getShopSettings(getDb()))
  on(IPC_CHANNELS.settingsSet, (input: Partial<ShopSettings>) =>
    settings.setShopSettings(getDb(), expectObject(input) as Partial<ShopSettings>)
  )
  on(IPC_CHANNELS.priceHistory, (productId: number) =>
    settings.getPriceHistory(getDb(), expectId(productId, 'معرف المنتج'))
  )
  on(IPC_CHANNELS.auditLog, () => audit.recentAuditEntries(getDb()))

  // ---- Backup / restore ---------------------------------------------------------------
  // createBackup is async (better-sqlite3 online backup API).
  onAsync(IPC_CHANNELS.backupCreate, (label: string) =>
    backup.createBackup(expectOptionalString(label))
  )
  on(IPC_CHANNELS.backupList, () => backup.listBackups())
  on(IPC_CHANNELS.backupValidate, (fileName: string) =>
    backup.validateBackupFile(expectString(fileName, 'اسم الملف'))
  )
  on(IPC_CHANNELS.backupRestore, (fileName: string) =>
    backup.restoreBackup(expectString(fileName, 'اسم الملف'))
  )
}

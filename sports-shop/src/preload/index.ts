import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC_CHANNELS, type DesktopAPI } from '../shared/electron-api'

/**
 * Explicit, minimal desktop API surface for the renderer.
 * NOTHING from Node.js or Electron is forwarded generically — each method
 * maps to one whitelisted IPC channel handled by the main process
 * (see src/main/ipc.ts). Business calls return structured IpcResult values.
 */

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args)

const idArg = (v: number): number => v

const desktopApi: DesktopAPI = {
  getAppMeta: () => invoke(IPC_CHANNELS.appMeta),
  categories: {
    list: () => invoke(IPC_CHANNELS.categoriesList)
  },
  products: {
    list: (options) => invoke(IPC_CHANNELS.productsList, options ?? {}),
    get: (id) => invoke(IPC_CHANNELS.productGet, idArg(id)),
    create: (input) => invoke(IPC_CHANNELS.productCreate, input),
    update: (input) => invoke(IPC_CHANNELS.productUpdate, input)
  },
  stock: {
    receive: (input) => invoke(IPC_CHANNELS.stockReceive, input),
    correct: (input) => invoke(IPC_CHANNELS.stockCorrect, input),
    movementsForProduct: (productId) =>
      invoke(IPC_CHANNELS.movementsForProduct, idArg(productId)),
    movementsAll: () => invoke(IPC_CHANNELS.movementsAll)
  },
  sales: {
    create: (input) => invoke(IPC_CHANNELS.saleCreate, input),
    list: (search) => invoke(IPC_CHANNELS.saleList, search ?? ''),
    get: (id) => invoke(IPC_CHANNELS.saleGet, idArg(id)),
    cancel: (id, reason) => invoke(IPC_CHANNELS.saleCancel, idArg(id), reason),
    recordReturn: (input) => invoke(IPC_CHANNELS.saleReturn, input),
    returnsForSale: (saleId) => invoke(IPC_CHANNELS.saleReturns, idArg(saleId))
  },
  orders: {
    create: (input) => invoke(IPC_CHANNELS.orderCreate, input),
    list: (status) => invoke(IPC_CHANNELS.orderList, status ?? 'ALL'),
    get: (id) => invoke(IPC_CHANNELS.orderGet, idArg(id)),
    setStatus: (id, status) => invoke(IPC_CHANNELS.orderSetStatus, idArg(id), status)
  },
  customers: {
    list: (includeInactive) => invoke(IPC_CHANNELS.customerList, includeInactive === true),
    create: (input) => invoke(IPC_CHANNELS.customerCreate, input),
    update: (id, input) => invoke(IPC_CHANNELS.customerUpdate, idArg(id), input),
    balances: () => invoke(IPC_CHANNELS.customerBalances)
  },
  suppliers: {
    list: (includeInactive) => invoke(IPC_CHANNELS.supplierList, includeInactive === true),
    create: (input) => invoke(IPC_CHANNELS.supplierCreate, input),
    purchaseBalances: () => invoke(IPC_CHANNELS.supplierPurchaseBalances)
  },
  purchases: {
    create: (input) => invoke(IPC_CHANNELS.purchaseCreate, input),
    list: (limit) => invoke(IPC_CHANNELS.purchaseList, limit ?? 100),
    get: (id) => invoke(IPC_CHANNELS.purchaseGet, idArg(id)),
    pay: (input) => invoke(IPC_CHANNELS.purchasePay, input),
    payments: (purchaseId) => invoke(IPC_CHANNELS.purchasePayments, idArg(purchaseId))
  },
  expenses: {
    categories: () => invoke(IPC_CHANNELS.expenseCategories),
    addCategory: (name) => invoke(IPC_CHANNELS.expenseAddCategory, name),
    create: (input) => invoke(IPC_CHANNELS.expenseCreate, input),
    list: (from, to) => invoke(IPC_CHANNELS.expenseList, from ?? '', to ?? '')
  },
  reports: {
    summary: (from, to) => invoke(IPC_CHANNELS.reportSummary, from, to),
    daily: (from, to) => invoke(IPC_CHANNELS.reportDaily, from, to),
    monthly: (from, to) => invoke(IPC_CHANNELS.reportMonthly, from, to)
  },
  settings: {
    getShop: () => invoke(IPC_CHANNELS.settingsGet),
    setShop: (input) => invoke(IPC_CHANNELS.settingsSet, input),
    priceHistory: (productId) => invoke(IPC_CHANNELS.priceHistory, idArg(productId)),
    auditLog: () => invoke(IPC_CHANNELS.auditLog)
  },
  backup: {
    create: (label) => invoke(IPC_CHANNELS.backupCreate, label ?? ''),
    list: () => invoke(IPC_CHANNELS.backupList),
    validate: (fileName) => invoke(IPC_CHANNELS.backupValidate, fileName),
    restore: (fileName) => invoke(IPC_CHANNELS.backupRestore, fileName)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to the renderer only
// if context isolation is enabled. It is always enabled in this app
// (see src/main/index.ts), so no fallback is provided.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('desktop', desktopApi)
  } catch (error) {
    console.error('Failed to expose preload API:', error)
  }
}

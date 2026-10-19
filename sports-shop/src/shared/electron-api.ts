import type {
  Category,
  CorrectStockInput,
  IpcResult,
  Product,
  ProductInput,
  ProductListOptions,
  ProductUpdate,
  ReceiveStockInput,
  StockMovement,
  StockMovementWithProduct
} from './types'

/**
 * Contract for the API that the preload script exposes to the renderer via
 * contextBridge (`window.desktop`). The renderer must NEVER rely on Node.js
 * or Electron APIs directly — only on this explicitly defined surface.
 *
 * Phase 2: narrow, typed business methods for categories, products and stock.
 * Every method maps to exactly one whitelisted ipcMain.handle channel in
 * `src/main/ipc.ts`. There is intentionally NO raw-SQL, generic-invoke or
 * filesystem method anywhere on this surface. All business calls return a
 * structured `IpcResult` so errors never cross the IPC boundary as throws.
 */

export interface DesktopAPI {
  /** Read-only application metadata provided by the main process. */
  getAppMeta(): Promise<{
    /** Semantic version of the application. */
    appVersion: string
    /** Always true: the app runs fully offline / locally. */
    offline: true
  }>

  categories: {
    list(): Promise<IpcResult<Category[]>>
  }

  products: {
    /** List/search active products, optionally filtered by category. */
    list(options?: ProductListOptions): Promise<IpcResult<Array<Product & { categoryName: string }>>>
    /** Single product by internal id (includes inactive ones). */
    get(id: number): Promise<IpcResult<Product>>
    /** Create with opening stock (recorded as an OPENING movement). */
    create(input: ProductInput): Promise<IpcResult<Product>>
    /** Edit data / activate-deactivate. Cannot change stock quantity. */
    update(input: ProductUpdate): Promise<IpcResult<Product>>
  }

  stock: {
    /** Receive a batch for an existing product (RECEIPT movement). */
    receive(input: ReceiveStockInput): Promise<IpcResult<Product>>
    /** Authorized correction with mandatory reason (CORRECTION_UP/DOWN). */
    correct(input: CorrectStockInput): Promise<IpcResult<Product>>
    /** Movement history for one product (most recent first). */
    movementsForProduct(productId: number): Promise<IpcResult<StockMovement[]>>
    /** Recent movement history across all products (inventory view). */
    movementsAll(): Promise<IpcResult<StockMovementWithProduct[]>>
  }
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
  movementsAll: 'movements:all'
} as const

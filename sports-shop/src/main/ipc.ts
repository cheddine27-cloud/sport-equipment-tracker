import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../shared/electron-api'
import { AppError, type IpcResult } from '../shared/types'
import { getDb } from './db'
import {
  correctStock,
  getAllMovements,
  getMovementsForProduct,
  getProduct,
  listCategories,
  listProducts,
  receiveStock,
  updateProduct,
  createProduct
} from './services/products'

/**
 * Registers the business IPC handlers. This module is the ONLY place where
 * DB services meet IPC. Rules enforced here:
 *  - Handlers accept exactly ONE plain-object argument (no arbitrary args).
 *  - Every handler validates its payload in the services layer (main process).
 *  - Nothing is ever thrown across the IPC boundary: results come back as a
 *    structured `IpcResult` ({ ok, data } | { ok:false, code, message }).
 *  - No raw SQL, no generic invoke, no filesystem access is exposed.
 */

type Handler<T> = () => T

/** Wraps a sync service call into a safe structured result. */
async function safe<T>(fn: Handler<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: fn() }
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

export function registerBusinessIpcHandlers(): void {
  // Categories -----------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.categoriesList, () => safe(() => listCategories(getDb())))

  // Products -------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.productsList, (_e, payload: unknown) =>
    safe(() => listProducts(getDb(), expectObject(payload) as never))
  )

  ipcMain.handle(IPC_CHANNELS.productGet, (_e, id: unknown) =>
    safe(() => {
      if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
        throw new AppError('VALIDATION', 'معرف المنتج غير صالح')
      }
      const product = getProduct(getDb(), id)
      if (!product) throw new AppError('NOT_FOUND', 'المنتج غير موجود')
      return product
    })
  )

  ipcMain.handle(IPC_CHANNELS.productCreate, (_e, payload: unknown) =>
    safe(() => createProduct(getDb(), expectObject(payload) as never))
  )

  ipcMain.handle(IPC_CHANNELS.productUpdate, (_e, payload: unknown) =>
    safe(() => updateProduct(getDb(), expectObject(payload) as never))
  )

  // Stock ------------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.stockReceive, (_e, payload: unknown) =>
    safe(() => receiveStock(getDb(), expectObject(payload) as never))
  )

  ipcMain.handle(IPC_CHANNELS.stockCorrect, (_e, payload: unknown) =>
    safe(() => correctStock(getDb(), expectObject(payload) as never))
  )

  ipcMain.handle(IPC_CHANNELS.movementsForProduct, (_e, productId: unknown) =>
    safe(() => {
      if (typeof productId !== 'number' || !Number.isInteger(productId) || productId <= 0) {
        throw new AppError('VALIDATION', 'معرف المنتج غير صالح')
      }
      return getMovementsForProduct(getDb(), productId)
    })
  )

  ipcMain.handle(IPC_CHANNELS.movementsAll, () => safe(() => getAllMovements(getDb())))
}

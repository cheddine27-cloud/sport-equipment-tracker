import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC_CHANNELS, type DesktopAPI } from '../shared/electron-api'

/**
 * Explicit, minimal desktop API surface for the renderer.
 * NOTHING from Node.js or Electron is forwarded generically — each method
 * maps to one whitelisted IPC channel handled by the main process
 * (see src/main/ipc.ts). Business calls return structured IpcResult values.
 */
const desktopApi: DesktopAPI = {
  getAppMeta: () => ipcRenderer.invoke(IPC_CHANNELS.appMeta),
  categories: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.categoriesList)
  },
  products: {
    list: (options) => ipcRenderer.invoke(IPC_CHANNELS.productsList, options ?? {}),
    get: (id) => ipcRenderer.invoke(IPC_CHANNELS.productGet, id),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.productCreate, input),
    update: (input) => ipcRenderer.invoke(IPC_CHANNELS.productUpdate, input)
  },
  stock: {
    receive: (input) => ipcRenderer.invoke(IPC_CHANNELS.stockReceive, input),
    correct: (input) => ipcRenderer.invoke(IPC_CHANNELS.stockCorrect, input),
    movementsForProduct: (productId) =>
      ipcRenderer.invoke(IPC_CHANNELS.movementsForProduct, productId),
    movementsAll: () => ipcRenderer.invoke(IPC_CHANNELS.movementsAll)
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

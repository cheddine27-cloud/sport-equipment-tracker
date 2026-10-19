import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { applyWindowSecurity } from './security'
import { IPC_CHANNELS } from '../shared/electron-api'
import { closeDb, getDb } from './db'
import { registerBusinessIpcHandlers } from './ipc'
import icon from '../../resources/icon.png?asset'

function createWindow(): void {
  // Main application window. Security-first webPreferences:
  //  - contextIsolation: ON   (renderer world isolated from preload world)
  //  - nodeIntegration:  OFF  (no Node.js in the renderer)
  //  - sandbox:          ON   (preload only exposes the explicit bridge)
  //  - webSecurity:      ON   (default; stated explicitly for clarity)
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'نظام تسيير المستلزمات الرياضية',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // HMR for renderer based on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * IPC handlers. Only narrow, explicitly whitelisted methods are exposed —
 * the business ones (products / stock / movements) live in `./ipc.ts` and
 * are backed by SQLite in the MAIN process only. The renderer never sees
 * raw SQL, ipcRenderer, Node.js or filesystem access.
 */
function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.appMeta, () => {
    return {
      appVersion: app.getVersion(),
      offline: true as const
    }
  })
  registerBusinessIpcHandlers()
}

// Single-instance lock: a shop terminal should run one copy of the app.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  applyWindowSecurity()

  app.whenReady().then(() => {
    // Set app user model id for Windows
    electronApp.setAppUserModelId('com.sportsshop.desktop')

    // Open (and migrate/seed on first run) the local SQLite database before
    // any window exists, so business IPC always has a ready connection.
    getDb()

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    registerIpcHandlers()
    createWindow()

    app.on('activate', function () {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  // Quit when all windows are closed, except on macOS.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  // Close the DB connection cleanly on quit (WAL checkpoint happens on close).
  app.on('will-quit', () => {
    closeDb()
  })
}

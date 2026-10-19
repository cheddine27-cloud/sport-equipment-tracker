import type { ElectronAPI } from '@electron-toolkit/preload'
import type { DesktopAPI } from '../shared/electron-api'

declare global {
  interface Window {
    /** Standard Electron API exposed by @electron-toolkit/preload. */
    electron: ElectronAPI
    /** Explicit, whitelisted desktop API for this application. */
    desktop: DesktopAPI
  }
}

/**
 * Main-process security hardening.
 * Applied once, before any window is created.
 */
import { app, shell } from 'electron'

/**
 * Blocks navigation of existing windows to remote URLs and denies all
 * popups — external links are handed to the OS browser instead.
 * This keeps the application strictly local (offline-first).
 */
export function applyWindowSecurity(): void {
  app.on('web-contents-created', (_event, contents) => {
    // Deny every new-window request; open http(s) links externally only.
    contents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) {
        void shell.openExternal(url)
      }
      return { action: 'deny' }
    })

    // Prevent the main window from being navigated away from the app.
    contents.on('will-navigate', (event, url) => {
      const allowedOrigin = isDevServerUrl(url) ? true : isLocalAppUrl(contents, url)
      if (!allowedOrigin && isSafeExternalUrl(url)) {
        event.preventDefault()
        void shell.openExternal(url)
      } else if (!allowedOrigin) {
        event.preventDefault()
      }
    })

    // Block attachment of webview elements entirely.
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
    })
  })

  // Never allow permission prompts (camera, mic, geolocation, ...) on any
  // web contents created by this application.
  app.on('web-contents-created', (_event, contents) => {
    contents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
      callback(false)
    })
  })
}

function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

function isDevServerUrl(url: string): boolean {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!devUrl) return false
  try {
    return new URL(url).origin === new URL(devUrl).origin
  } catch {
    return false
  }
}

function isLocalAppUrl(contents: Electron.WebContents, url: string): boolean {
  try {
    return (
      new URL(url).protocol === 'file:' && new URL(url).origin === new URL(contents.getURL()).origin
    )
  } catch {
    return false
  }
}

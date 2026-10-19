import type { IpcResult } from '../../../shared/types'

/**
 * Small renderer-side helpers for the typed `window.desktop` bridge.
 * The renderer never touches ipcRenderer/Node — only the whitelisted API.
 */

/** Unwraps an IpcResult: returns data or throws Error with the Arabic message. */
export async function unwrap<T>(promise: Promise<IpcResult<T>>): Promise<T> {
  const res = await promise
  if (res.ok) return res.data
  throw new Error(res.message)
}

/** Unwraps an IpcResult into a [data, errorMessage] tuple (no throwing). */
export async function settle<T>(
  promise: Promise<IpcResult<T>>
): Promise<{ data: T } | { error: string }> {
  const res = await promise
  if (res.ok) return { data: res.data }
  return { error: res.message }
}

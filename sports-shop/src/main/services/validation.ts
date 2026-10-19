import { AppError } from '../../shared/types'

/**
 * Input validation helpers used by the services layer. Everything arriving
 * through IPC is treated as untrusted: types, ranges and lengths are checked
 * in the MAIN process before any SQL runs. All statements are parameterized;
 * values never reach SQLite as raw text.
 */

const MAX_TEXT_LEN = 200
const MAX_REASON_LEN = 500

export function requireString(value: unknown, field: string, maxLen = MAX_TEXT_LEN): string {
  if (typeof value !== 'string') throw new AppError('VALIDATION', `الحقل «${field}» يجب أن يكون نصاً`)
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new AppError('VALIDATION', `الحقل «${field}» مطلوب`)
  if (trimmed.length > maxLen) {
    throw new AppError('VALIDATION', `الحقل «${field}» طويل جداً (الحد الأقصى ${maxLen} حرفاً)`)
  }
  return trimmed
}

/** Optional free-text field: empty/whitespace/null become null. */
export function optionalText(value: unknown, field: string, maxLen = MAX_TEXT_LEN): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new AppError('VALIDATION', `الحقل «${field}» يجب أن يكون نصاً`)
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > maxLen) {
    throw new AppError('VALIDATION', `الحقل «${field}» طويل جداً (الحد الأقصى ${maxLen} حرفاً)`)
  }
  return trimmed
}

/** Non-negative integer (prices in DZD, quantities, thresholds). */
export function nonNegativeInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new AppError('VALIDATION', `الحقل «${field}» يجب أن يكون عدداً صحيحاً بالدينار/الوحدة`)
  }
  if (value < 0) throw new AppError('VALIDATION', `الحقل «${field}» لا يمكن أن يكون سالباً`)
  if (!Number.isSafeInteger(value)) throw new AppError('VALIDATION', `الحقل «${field}» كبير جداً`)
  return value
}

/** Strictly positive integer (received batch size). */
export function positiveInt(value: unknown, field: string): number {
  const n = nonNegativeInt(value, field)
  if (n === 0) throw new AppError('VALIDATION', `الحقل «${field}» يجب أن يكون أكبر من صفر`)
  return n
}

/** Boolean with coercion from 0/1 (SQLite stores booleans as integers). */
export function requireBoolean(value: unknown, field: string): boolean {
  if (value === 0 || value === 1) return value === 1
  if (typeof value !== 'boolean') throw new AppError('VALIDATION', `الحقل «${field}» يجب أن يكون نعم/لا`)
  return value
}

/** Mandatory reason for stock corrections (max 500 chars). */
export function requireReason(value: unknown): string {
  const r = requireString(value, 'سبب التصحيح', MAX_REASON_LEN)
  if (r.length < 3) throw new AppError('VALIDATION', 'سبب التصحيح قصير جداً (٣ أحرف على الأقل)')
  return r
}

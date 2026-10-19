/**
 * Amount formatting for the Algerian dinar (DZD).
 * All monetary values in the application are displayed through these
 * helpers so the format stays consistent across every module.
 */

const CURRENCY_SYMBOL = 'دج'

/**
 * Formats a numeric amount as "1,250.50 دج" with locale-aware thousands
 * grouping and Latin digits for readability in tables and receipts.
 */
export function formatDZD(amount: number): string {
  if (!Number.isFinite(amount)) return `— ${CURRENCY_SYMBOL}`
  const formatted = new Intl.NumberFormat('fr-DZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    useGrouping: true
  }).format(amount)
  return `${formatted} ${CURRENCY_SYMBOL}`
}

export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  OPENING: 'رصيد افتتاحي',
  RECEIPT: 'استلام دفعة',
  CORRECTION_UP: 'تصحيح بالزيادة',
  CORRECTION_DOWN: 'تصحيح بالعجز'
}

/** Formats SQLite `datetime('now')` (UTC) as local Arabic date/time. */
export function formatDateTime(utc: string): string {
  const d = new Date(utc.includes('T') ? utc : utc.replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return utc
  return new Intl.DateTimeFormat('ar-DZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    numberingSystem: 'latn'
  }).format(d)
}

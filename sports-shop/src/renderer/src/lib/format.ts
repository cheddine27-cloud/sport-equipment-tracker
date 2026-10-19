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

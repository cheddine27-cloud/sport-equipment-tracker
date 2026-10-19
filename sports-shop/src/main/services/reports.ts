/**
 * Financial reports computed from STORED transactions (never UI totals).
 * All figures are integer DZD. `from`/`to` are ISO dates, inclusive; the
 * sales/purchases timestamps are compared with date(created_at).
 */
import type Database from 'better-sqlite3'
import type { ReportSummary } from '../../shared/types'
import { sumExpenses } from './expenses'

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

export function reportSummary(db: Database.Database, from: string, to: string): ReportSummary {
  const sales = db
    .prepare(
      `SELECT COALESCE(SUM(total), 0) AS revenue, COALESCE(SUM(discount), 0) AS discounts,
              COALESCE(SUM(paid), 0) AS paidv, COUNT(*) AS n
       FROM sales WHERE status = 'COMPLETED' AND date(created_at) BETWEEN ? AND ?`
    )
    .get(from, to) as Record<string, number>

  // COGS uses sale-time purchase price snapshots × sold qty minus returned qty.
  const cogsRow = db
    .prepare(
      `SELECT COALESCE(SUM(si.purchase_price * (si.quantity - si.returned_qty)), 0) AS cogs
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.status = 'COMPLETED' AND date(s.created_at) BETWEEN ? AND ?`
    )
    .get(from, to) as Record<string, number>

  const refundsRow = db
    .prepare(
      `SELECT COALESCE(SUM(r.amount_refunded), 0) AS refunds
       FROM returns r JOIN sales s ON s.id = r.sale_id
       WHERE date(r.created_at) BETWEEN ? AND ?`
    )
    .get(from, to) as Record<string, number>

  const cancelledRow = db
    .prepare(
      `SELECT COALESCE(SUM(total), 0) AS t FROM sales
       WHERE status = 'CANCELLED' AND cancelled_at IS NOT NULL AND date(cancelled_at) BETWEEN ? AND ?`
    )
    .get(from, to) as Record<string, number>

  const receivablesRow = db
    .prepare(`SELECT COALESCE(SUM(balance), 0) AS b FROM sales WHERE status = 'COMPLETED'`)
    .get() as Record<string, number>

  const purchasesRow = db
    .prepare(`SELECT COALESCE(SUM(total), 0) AS t FROM purchases WHERE date(created_at) BETWEEN ? AND ?`)
    .get(from, to) as Record<string, number>

  const revenue = num(sales.revenue)
  const discounts = num(sales.discounts)
  const refunds = num(refundsRow.refunds)
  const cogs = num(cogsRow.cogs)
  const expensesTotal = sumExpenses(db, from, to)
  const grossProfit = revenue - cogs - discounts - refunds
  return {
    from,
    to,
    revenue,
    discounts,
    refunds,
    cancelledSalesTotal: num(cancelledRow.t),
    cashReceived: num(sales.paidv),
    receivables: num(receivablesRow.b),
    cogs,
    grossProfit,
    expensesTotal,
    netProfit: grossProfit - expensesTotal,
    purchasesTotal: num(purchasesRow.t),
    salesCount: num(sales.n)
  }
}

/** Daily buckets for a period — used by the reports charts/tables. */
export function dailySales(db: Database.Database, from: string, to: string): Array<{
  day: string; revenue: number; discount: number; paid: number; count: number; cogs: number
}> {
  const rows = db
    .prepare(
      `SELECT date(s.created_at) AS day, SUM(s.total) AS revenue, SUM(s.discount) AS discount,
              SUM(s.paid) AS paidv, COUNT(*) AS n,
              (SELECT COALESCE(SUM(si.purchase_price * (si.quantity - si.returned_qty)), 0)
                 FROM sale_items si WHERE si.sale_id IN
                 (SELECT id FROM sales WHERE status = 'COMPLETED' AND date(created_at) = date(s.created_at))) AS cogs
       FROM sales s WHERE s.status = 'COMPLETED' AND date(s.created_at) BETWEEN ? AND ?
       GROUP BY day ORDER BY day`
    )
    .all(from, to) as Array<{ day: string; revenue: number; discount: number; paidv: number; n: number; cogs: number }>
  return rows.map((r) => ({
    day: r.day, revenue: r.revenue, discount: r.discount, paid: r.paidv, count: r.n, cogs: r.cogs
  }))
}

/** Monthly buckets keyed by YYYY-MM. */
export function monthlySales(db: Database.Database, from: string, to: string): Array<{ month: string; revenue: number; discount: number; paid: number; count: number; cogs: number; expenses: number }> {
  const salesRows = db
    .prepare(
      `SELECT strftime('%Y-%m', created_at) AS m, SUM(total) AS revenue, SUM(discount) AS discount,
              SUM(paid) AS paidv, COUNT(*) AS n
       FROM sales WHERE status = 'COMPLETED' AND date(created_at) BETWEEN ? AND ?
       GROUP BY m ORDER BY m`
    )
    .all(from, to) as Array<{ m: string; revenue: number; discount: number; paidv: number; n: number }>
  const cogsRows = db
    .prepare(
      `SELECT strftime('%Y-%m', s.created_at) AS m,
              COALESCE(SUM(si.purchase_price * (si.quantity - si.returned_qty)), 0) AS cogs
       FROM sales s JOIN sale_items si ON si.sale_id = s.id
       WHERE s.status = 'COMPLETED' AND date(s.created_at) BETWEEN ? AND ?
       GROUP BY m`
    )
    .all(from, to) as Array<{ m: string; cogs: number }>
  const expRows = db
    .prepare(
      `SELECT strftime('%Y-%m', spent_on) AS m, COALESCE(SUM(amount), 0) AS e
       FROM expenses WHERE spent_on BETWEEN ? AND ? GROUP BY m`
    )
    .all(from, to) as Array<{ m: string; e: number }>
  const cogsBy = new Map(cogsRows.map((r) => [r.m, r.cogs]))
  const expBy = new Map(expRows.map((r) => [r.m, r.e]))
  return salesRows.map((r) => ({
    month: r.m, revenue: r.revenue, discount: r.discount, paid: r.paidv, count: r.n,
    cogs: cogsBy.get(r.m) ?? 0, expenses: expBy.get(r.m) ?? 0
  }))
}

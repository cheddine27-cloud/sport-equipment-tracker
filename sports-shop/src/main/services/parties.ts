/** Customers & suppliers: records, balances and transaction history. */
import type Database from 'better-sqlite3'
import { AppError, type Customer, type CustomerInput, type PartyBalance } from '../../shared/types'
import { optionalText, requireString } from './validation'
import { logAudit } from './audit'

interface PartyRow {
  id: number; name: string; phone: string | null; address: string | null
  note: string | null; active: number; created_at: string; updated_at: string
}

function mapCustomer(r: PartyRow): Customer {
  return {
    id: r.id, name: r.name, phone: r.phone, address: r.address, note: r.note,
    active: r.active === 1, createdAt: r.created_at, updatedAt: r.updated_at
  }
}

const PARTY_COLS = 'id, name, phone, address, note, active, created_at, updated_at'

export function listCustomers(db: Database.Database, includeInactive = false): Customer[] {
  const rows = db
    .prepare(`SELECT ${PARTY_COLS} FROM customers ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY name COLLATE NOCASE`)
    .all() as PartyRow[]
  return rows.map(mapCustomer)
}

export function createCustomer(db: Database.Database, input: CustomerInput): Customer {
  const name = requireString(input.name, 'اسم الزبون', 120)
  const phone = optionalText(input.phone, 'الهاتف', 40)
  const address = optionalText(input.address, 'العنوان', 200)
  const note = optionalText(input.note, 'ملاحظة', 500)
  const dup = db.prepare('SELECT id FROM customers WHERE name = ? AND active = 1').get(name)
  if (dup) throw new AppError('DUPLICATE_CODE', `زبون باسم «${name}» مسجّل مسبقاً`)
  const info = db.prepare('INSERT INTO customers (name, phone, address, note) VALUES (?, ?, ?, ?)').run(name, phone, address, note)
  const id = Number(info.lastInsertRowid)
  logAudit(db, 'CREATE_CUSTOMER', 'customer', id, name)
  return getCustomer(db, id)!
}

export function getCustomer(db: Database.Database, id: number): Customer | null {
  const row = db.prepare(`SELECT ${PARTY_COLS} FROM customers WHERE id = ?`).get(id) as PartyRow | undefined
  return row ? mapCustomer(row) : null
}

export function updateCustomer(db: Database.Database, id: number, input: CustomerInput & { active?: boolean }): Customer {
  const existing = getCustomer(db, id)
  if (!existing) throw new AppError('NOT_FOUND', 'الزبون غير موجود')
  const name = requireString(input.name, 'اسم الزبون', 120)
  const phone = optionalText(input.phone, 'الهاتف', 40)
  const address = optionalText(input.address, 'العنوان', 200)
  const note = optionalText(input.note, 'ملاحظة', 500)
  const active = input.active ?? existing.active
  db.prepare(
    `UPDATE customers SET name = ?, phone = ?, address = ?, note = ?, active = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(name, phone, address, note, active ? 1 : 0, id)
  logAudit(db, 'UPDATE_CUSTOMER', 'customer', id, name)
  return getCustomer(db, id)!
}

/** Customer balances derived from stored sales (billed = non-cancelled totals, paid = sum(paid)). */
export function customerBalances(db: Database.Database): PartyBalance[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.name,
              COALESCE((SELECT SUM(s.total) FROM sales s WHERE s.customer_id = c.id AND s.status = 'COMPLETED'), 0) AS billed,
              COALESCE((SELECT SUM(s.paid) FROM sales s WHERE s.customer_id = c.id AND s.status = 'COMPLETED'), 0) AS paidv
       FROM customers c WHERE c.active = 1 ORDER BY c.name COLLATE NOCASE`
    )
    .all() as Array<{ id: number; name: string; billed: number; paidv: number }>
  return rows.map((r) => ({
    partyId: r.id, name: r.name, totalBilled: r.billed, totalPaid: r.paidv, outstanding: r.billed - r.paidv
  }))
}

// Suppliers ---------------------------------------------------------------------

export function listSuppliers(db: Database.Database, includeInactive = false): Customer[] {
  const rows = db
    .prepare(`SELECT ${PARTY_COLS} FROM suppliers ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY name COLLATE NOCASE`)
    .all() as PartyRow[]
  return rows.map(mapCustomer)
}

export function createSupplier(db: Database.Database, input: CustomerInput): Customer {
  const name = requireString(input.name, 'اسم المورد', 120)
  const phone = optionalText(input.phone, 'الهاتف', 40)
  const address = optionalText(input.address, 'العنوان', 200)
  const note = optionalText(input.note, 'ملاحظة', 500)
  const dup = db.prepare('SELECT id FROM suppliers WHERE name = ? AND active = 1').get(name)
  if (dup) throw new AppError('DUPLICATE_CODE', `مورد باسم «${name}» مسجّل مسبقاً`)
  const info = db.prepare('INSERT INTO suppliers (name, phone, address, note) VALUES (?, ?, ?, ?)').run(name, phone, address, note)
  const id = Number(info.lastInsertRowid)
  logAudit(db, 'CREATE_SUPPLIER', 'supplier', id, name)
  return getSupplier(db, id)!
}

export function getSupplier(db: Database.Database, id: number): Customer | null {
  const row = db.prepare(`SELECT ${PARTY_COLS} FROM suppliers WHERE id = ?`).get(id) as PartyRow | undefined
  return row ? mapCustomer(row) : null
}

/** Supplier debt per purchase: total − paid (payments + initial). */
export function supplierPurchaseBalances(db: Database.Database): Array<{
  purchaseId: number; receiptNo: string; supplierName: string; total: number; paid: number; remaining: number; createdAt: string
}> {
  const rows = db
    .prepare(
      `SELECT p.id, p.receipt_no, p.supplier_name, p.total,
              p.paid + COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.purchase_id = p.id), 0) AS paidv,
              p.created_at
       FROM purchases p ORDER BY p.id DESC LIMIT 300`
    )
    .all() as Array<{ id: number; receipt_no: string; supplier_name: string; total: number; paidv: number; created_at: string }>
  return rows.map((r) => ({
    purchaseId: r.id, receiptNo: r.receipt_no, supplierName: r.supplier_name,
    total: r.total, paid: r.paidv, remaining: Math.max(0, r.total - r.paidv), createdAt: r.created_at
  }))
}

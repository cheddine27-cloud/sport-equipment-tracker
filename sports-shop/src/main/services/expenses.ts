/** Operating expenses with categories and date filtering. */
import type Database from 'better-sqlite3'
import { AppError, type Expense, type ExpenseCategory, type ExpenseInput } from '../../shared/types'
import { nonNegativeInt, optionalText, requireString } from './validation'
import { logAudit } from './audit'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function listExpenseCategories(db: Database.Database): ExpenseCategory[] {
  const rows = db.prepare('SELECT id, name FROM expense_categories ORDER BY id').all() as Array<{ id: number; name: string }>
  return rows
}

export function createExpenseCategory(db: Database.Database, nameRaw: string): ExpenseCategory {
  const name = requireString(nameRaw, 'اسم فئة المصروف', 80)
  const dup = db.prepare('SELECT id FROM expense_categories WHERE name = ?').get(name)
  if (dup) throw new AppError('DUPLICATE_CODE', `فئة «${name}» موجودة مسبقاً`)
  const info = db.prepare('INSERT INTO expense_categories (name) VALUES (?)').run(name)
  return { id: Number(info.lastInsertRowid), name }
}

export function createExpense(db: Database.Database, input: ExpenseInput): Expense {
  const categoryId = nonNegativeInt(input.categoryId, 'فئة المصروف')
  const amount = nonNegativeInt(input.amount, 'قيمة المصروف')
  if (amount === 0) throw new AppError('VALIDATION', 'قيمة المصروف يجب أن تكون أكبر من صفر')
  const description = optionalText(input.description, 'الوصف', 300)
  const spentOn = requireString(input.spentOn, 'التاريخ')
  if (!DATE_RE.test(spentOn)) throw new AppError('VALIDATION', 'التاريخ يجب أن يكون بالصيغة YYYY-MM-DD')
  const cat = db.prepare('SELECT id, name FROM expense_categories WHERE id = ?').get(categoryId) as { id: number; name: string } | undefined
  if (!cat) throw new AppError('NOT_FOUND', 'فئة المصروف غير موجودة')
  const tx = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO expenses (category_id, amount, description, spent_on) VALUES (?, ?, ?, ?)')
      .run(categoryId, amount, description, spentOn)
    const id = Number(info.lastInsertRowid)
    logAudit(db, 'CREATE_EXPENSE', 'expense', id, `${cat.name} — ${amount} دج (${spentOn})`)
    return id
  })
  const id = tx()
  return getExpense(db, id)!
}

function mapExpense(r: { id: number; category_id: number; category_name: string; amount: number; description: string | null; spent_on: string; created_at: string }): Expense {
  return {
    id: r.id, categoryId: r.category_id, categoryName: r.category_name, amount: r.amount,
    description: r.description, spentOn: r.spent_on, createdAt: r.created_at
  }
}

const EXPENSE_SELECT = `SELECT e.id, e.category_id, c.name AS category_name, e.amount, e.description,
  e.spent_on, e.created_at FROM expenses e JOIN expense_categories c ON c.id = e.category_id`

export function getExpense(db: Database.Database, id: number): Expense | null {
  const row = db.prepare(`${EXPENSE_SELECT} WHERE e.id = ?`).get(id) as Parameters<typeof mapExpense>[0] | undefined
  return row ? mapExpense(row) : null
}

/** Expenses between two ISO dates inclusive (from/to may be '' for open bounds). */
export function listExpenses(db: Database.Database, from = '', to = '', limit = 500): Expense[] {
  const params: unknown[] = []
  let sql = EXPENSE_SELECT + ' WHERE 1=1'
  if (from) { sql += ' AND e.spent_on >= ?'; params.push(from) }
  if (to) { sql += ' AND e.spent_on <= ?'; params.push(to) }
  sql += ' ORDER BY e.spent_on DESC, e.id DESC LIMIT ?'
  params.push(limit)
  const rows = db.prepare(sql).all(...params) as Array<Parameters<typeof mapExpense>[0]>
  return rows.map(mapExpense)
}

export function sumExpenses(db: Database.Database, from: string, to: string): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM expenses WHERE spent_on >= ? AND spent_on <= ?`)
    .get(from, to) as { s: number }
  return row.s
}

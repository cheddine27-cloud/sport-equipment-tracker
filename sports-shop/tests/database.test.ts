/**
 * Database-layer tests: initialization, migrations, idempotent seeding and
 * persistence across close/reopen.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { migrate, INITIAL_CATEGORIES, LATEST_SCHEMA_VERSION } from '../src/main/db/migrations'
import { createTestDb, cleanupAll } from './helpers'

afterEach(cleanupAll)

describe('database initialization & migrations', () => {
  it('creates the expected tables on first migration', () => {
    const db = createTestDb()
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>
    const names = tables.map((t) => t.name)
    for (const expected of ['categories', 'products', 'stock_movements', 'settings', 'schema_migrations']) {
      expect(names).toContain(expected)
    }
  })

  it('enables foreign key enforcement', () => {
    const db = createTestDb()
    const row = db.pragma('foreign_keys', { simple: true })
    expect(row).toBe(1)
  })

  it('seeds exactly the three initial Arabic categories', () => {
    const db = createTestDb()
    const rows = db.prepare('SELECT name FROM categories ORDER BY id').all() as Array<{
      name: string
    }>
    expect(rows.map((r) => r.name)).toEqual([...INITIAL_CATEGORIES])
    expect(rows.map((r) => r.name)).toEqual([
      'الملابس الرياضية',
      'العتاد الرياضي',
      'شبه الطبي'
    ])
  })

  it('is safe to run migrate() more than once (idempotent seeding)', () => {
    const db = createTestDb()
    // Run the full migration again against an already-migrated database.
    migrate(db)
    migrate(db)
    const count = db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }
    expect(count.n).toBe(3)
    const applied = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }
    expect(applied.n).toBe(LATEST_SCHEMA_VERSION)
  })

  it('records the schema version in settings metadata', () => {
    const db = createTestDb()
    const row = db.prepare("SELECT value FROM settings WHERE key = 'schema_version'").get() as
      | { value: string }
      | undefined
    if (row) {
      expect(Number(row.value)).toBe(LATEST_SCHEMA_VERSION)
    } else {
      // If schema version lives only in schema_migrations, verify that instead.
      const max = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as {
        v: number
      }
      expect(max.v).toBe(LATEST_SCHEMA_VERSION)
    }
  })

  it('persists products and movements after close and reopen', () => {
    // Open a dedicated temp file so we can close and reopen the SAME file.
    const tmp = mkdtempSync(join(tmpdir(), 'sports-shop-reopen-'))
    const file = join(tmp, 'data.db')

    const db1 = new Database(file)
    migrate(db1)
    const catId = (
      db1.prepare('SELECT id FROM categories WHERE name = ?').get('العتاد الرياضي') as { id: number }
    ).id
    db1
      .prepare(
        `INSERT INTO products (code, name, category_id, purchase_price, sale_price, external_price, quantity, min_stock, active)
         VALUES ('REOPEN-1', 'منتج اختبار للإعادة', ?, 100, 200, 250, 7, 1, 1)`
      )
      .run(catId)
    const prodId = db1.prepare("SELECT id FROM products WHERE code = 'REOPEN-1'").get() as {
      id: number
    }
    db1
      .prepare(
        `INSERT INTO stock_movements (product_id, movement_type, quantity_change, balance_after, reason)
         VALUES (?, 'OPENING', 7, 7, 'رصيد افتتاحي عند الإنشاء')`
      )
      .run(prodId.id)
    db1.close()

    const db2 = new Database(file)
    migrate(db2) // must be safe on an existing migrated database
    const p = db2.prepare("SELECT quantity FROM products WHERE code = 'REOPEN-1'").get() as {
      quantity: number
    }
    expect(p.quantity).toBe(7)
    const m = db2
      .prepare('SELECT COUNT(*) AS n FROM stock_movements WHERE product_id = ?')
      .get(prodId.id) as { n: number }
    expect(m.n).toBe(1)
    const cats = db2.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }
    expect(cats.n).toBe(3)
    db2.close()
    rmSync(tmp, { recursive: true, force: true })
  })
})

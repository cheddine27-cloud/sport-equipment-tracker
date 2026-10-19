/**
 * Shared test helpers: isolated temp SQLite databases for the database and
 * product-service tests. Tests never touch Electron's real userData database.
 */
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { migrate } from '../src/main/db/migrations'
import type { ProductInput } from '../src/shared/types'

const openDbs: Database.Database[] = []
const tempDirs: string[] = []

/** Opens a fresh migrated database in its own temporary directory. */
export function createTestDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'sports-shop-test-'))
  tempDirs.push(dir)
  const db = new Database(join(dir, 'test.db'))
  migrate(db)
  openDbs.push(db)
  return db
}

/** Closes every database opened by createTestDb() and removes temp files. */
export function cleanupAll(): void {
  while (openDbs.length) {
    const db = openDbs.pop()
    try {
      if (db && db.open) db.close()
    } catch {
      /* already closed */
    }
  }
  while (tempDirs.length) {
    const dir = tempDirs.pop()
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* best effort */
      }
    }
  }
}

/** Returns the id of a seeded category by exact Arabic name. */
export function categoryIdByName(db: Database.Database, name: string): number {
  const row = db.prepare('SELECT id FROM categories WHERE name = ?').get(name) as
    | { id: number }
    | undefined
  if (!row) throw new Error(`الفئة «${name}» غير موجودة — زرع الفئات فشل`)
  return row.id
}

/** Builds a valid ProductInput with overridable fields. No fake shop data —
 * these are obviously synthetic test values. */
export function makeProductInput(
  db: Database.Database,
  overrides: Partial<ProductInput> = {}
): ProductInput {
  return {
    code: 'TEST-SKU-001',
    name: 'منتج اختبار',
    categoryId: categoryIdByName(db, 'العتاد الرياضي'),
    size: null,
    color: null,
    material: null,
    purchasePrice: 1000,
    salePrice: 1500,
    externalPrice: 1800,
    openingQuantity: 10,
    minStock: 2,
    supplierRef: null,
    ...overrides
  }
}

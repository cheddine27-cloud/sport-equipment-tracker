import type Database from 'better-sqlite3'

/**
 * Versioned migration runner. Each migration has an increasing integer
 * version; applied versions are recorded in `schema_migrations` inside the
 * same transaction as the migration itself, so a failed migration is fully
 * rolled back and can be retried on next startup.
 */

interface Migration {
  version: number
  name: string
  up: (db: Database.Database) => void
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial-schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE categories (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          name       TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE products (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          code           TEXT    NOT NULL UNIQUE,
          name           TEXT    NOT NULL,
          category_id    INTEGER NOT NULL REFERENCES categories(id),
          size           TEXT,
          color          TEXT,
          material       TEXT,
          purchase_price INTEGER NOT NULL CHECK (purchase_price >= 0),
          sale_price     INTEGER NOT NULL CHECK (sale_price >= 0),
          external_price INTEGER NOT NULL CHECK (external_price >= 0),
          quantity       INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
          min_stock      INTEGER NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
          supplier_ref   TEXT,
          active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
          created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_products_category ON products(category_id);
        CREATE INDEX idx_products_name    ON products(name);

        CREATE TABLE stock_movements (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id      INTEGER NOT NULL REFERENCES products(id),
          movement_type   TEXT    NOT NULL CHECK (movement_type IN
                            ('OPENING','RECEIPT','CORRECTION_UP','CORRECTION_DOWN')),
          quantity_change INTEGER NOT NULL CHECK (quantity_change != 0),
          balance_after   INTEGER NOT NULL CHECK (balance_after >= 0),
          reason          TEXT,
          created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX idx_movements_product ON stock_movements(product_id);
        CREATE INDEX idx_movements_time    ON stock_movements(created_at);

        CREATE TABLE settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `)
    }
  }
]

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

/** The three initial categories required by the specification (idempotent). */
export const INITIAL_CATEGORIES = ['الملابس الرياضية', 'العتاد الرياضي', 'شبه الطبي'] as const

function seedCategories(db: Database.Database): void {
  const insert = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)')
  for (const name of INITIAL_CATEGORIES) insert.run(name)
}

/**
 * Opens/creates the schema at `db`: pragmas, pending migrations, seed data
 * and the schema-version setting. Safe to call on every application start.
 */
export function migrate(db: Database.Database): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((r) => (r as { version: number }).version)
  )

  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue
    const apply = db.transaction(() => {
      m.up(db)
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name)
    })
    apply()
  }

  // Seed runs inside its own transaction; INSERT OR IGNORE keeps it idempotent
  // so re-opening an existing database never duplicates or deletes data.
  db.transaction(seedCategories)(db)

  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(LATEST_SCHEMA_VERSION))
}

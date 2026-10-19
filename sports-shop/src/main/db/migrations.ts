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
  /** When true, this migration must run while foreign_keys enforcement is OFF
   * (e.g. rebuilding tables that are referenced by other tables). The runner
   * toggles the pragma outside any transaction (PRAGMA is a no-op inside one). */
  foreignKeysOff?: boolean
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
  },
  {
    version: 2,
    name: 'sales-and-returns',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sales (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          invoice_no      TEXT    NOT NULL UNIQUE,
          subtotal        INTEGER NOT NULL CHECK (subtotal >= 0),
          discount        INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
          total           INTEGER NOT NULL CHECK (total >= 0),
          paid            INTEGER NOT NULL DEFAULT 0 CHECK (paid >= 0),
          balance         INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
          payment_method  TEXT    NOT NULL DEFAULT 'CASH' CHECK (payment_method IN ('CASH','CARD')),
          status          TEXT    NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED','CANCELLED')),
          cancelled_at    TEXT,
          cancel_reason   TEXT,
          note            TEXT,
          created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_sales_time ON sales(created_at);

        CREATE TABLE IF NOT EXISTS sale_items (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          sale_id        INTEGER NOT NULL REFERENCES sales(id),
          product_id     INTEGER NOT NULL REFERENCES products(id),
          quantity       INTEGER NOT NULL CHECK (quantity > 0),
          unit_price     INTEGER NOT NULL CHECK (unit_price >= 0),
          purchase_price INTEGER NOT NULL CHECK (purchase_price >= 0),
          returned_qty   INTEGER NOT NULL DEFAULT 0 CHECK
                           (returned_qty >= 0 AND returned_qty <= quantity),
          created_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_sale_items_sale    ON sale_items(sale_id);
        CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);

        CREATE TABLE IF NOT EXISTS returns (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          return_no       TEXT    NOT NULL UNIQUE,
          sale_id         INTEGER NOT NULL REFERENCES sales(id),
          sale_item_id    INTEGER NOT NULL REFERENCES sale_items(id),
          quantity        INTEGER NOT NULL CHECK (quantity > 0),
          amount_refunded INTEGER NOT NULL CHECK (amount_refunded >= 0),
          reason          TEXT    NOT NULL,
          created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_returns_sale ON returns(sale_id);

        -- New vocabulary of movement types + audit references. A brand-new
        -- table is used instead of rebuilding the old one so existing history
        -- stays untouched; it is dropped only once rows start flowing.
        CREATE TABLE IF NOT EXISTS stock_movements_v2 (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id      INTEGER NOT NULL REFERENCES products(id),
          movement_type   TEXT    NOT NULL CHECK (movement_type IN
                            ('OPENING','RECEIPT','CORRECTION_UP','CORRECTION_DOWN',
                             'SALE','SALE_CANCEL','RETURN','PURCHASE')),
          quantity_change INTEGER NOT NULL CHECK (quantity_change != 0),
          balance_after   INTEGER NOT NULL CHECK (balance_after >= 0),
          reason          TEXT,
          ref_type        TEXT,
          ref_id          INTEGER,
          created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_movements_v2_product ON stock_movements_v2(product_id);
        CREATE INDEX IF NOT EXISTS idx_movements_v2_time    ON stock_movements_v2(created_at);
      `)
    }
  },
  {
    version: 3,
    name: 'customers-suppliers-purchases',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS customers (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          name       TEXT NOT NULL,
          phone      TEXT,
          address    TEXT,
          note       TEXT,
          active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS suppliers (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          name       TEXT NOT NULL,
          phone      TEXT,
          address    TEXT,
          note       TEXT,
          active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS purchases (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          receipt_no    TEXT    NOT NULL UNIQUE,
          supplier_id   INTEGER REFERENCES suppliers(id),
          supplier_name TEXT    NOT NULL,
          total         INTEGER NOT NULL CHECK (total >= 0),
          paid          INTEGER NOT NULL DEFAULT 0 CHECK (paid >= 0),
          note          TEXT,
          created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_purchases_time ON purchases(created_at);

        CREATE TABLE IF NOT EXISTS purchase_items (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          purchase_id INTEGER NOT NULL REFERENCES purchases(id),
          product_id  INTEGER NOT NULL REFERENCES products(id),
          quantity    INTEGER NOT NULL CHECK (quantity > 0),
          unit_cost   INTEGER NOT NULL CHECK (unit_cost >= 0),
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);
        CREATE INDEX IF NOT EXISTS idx_purchase_items_product  ON purchase_items(product_id);

        CREATE TABLE IF NOT EXISTS supplier_payments (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          purchase_id INTEGER NOT NULL REFERENCES purchases(id),
          amount      INTEGER NOT NULL CHECK (amount > 0),
          note        TEXT,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_supplier_pay_purchase ON supplier_payments(purchase_id);

        ALTER TABLE sales ADD COLUMN customer_id INTEGER REFERENCES customers(id);
        ALTER TABLE sales ADD COLUMN customer_name TEXT;
      `)
    }
  },
  {
    version: 4,
    name: 'expenses-audit-orders',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS expense_categories (
          id   INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS expenses (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          category_id INTEGER NOT NULL REFERENCES expense_categories(id),
          amount      INTEGER NOT NULL CHECK (amount >= 0),
          description TEXT,
          spent_on    TEXT NOT NULL,
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(spent_on);

        CREATE TABLE IF NOT EXISTS audit_log (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          action     TEXT NOT NULL,
          entity     TEXT NOT NULL,
          entity_id  INTEGER,
          details    TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS orders (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          order_no      TEXT    NOT NULL UNIQUE,
          customer_name TEXT    NOT NULL,
          phone         TEXT,
          address       TEXT,
          note          TEXT,
          status        TEXT    NOT NULL DEFAULT 'PENDING' CHECK
                          (status IN ('PENDING','CONFIRMED','DISPATCHED','DELIVERED','CANCELLED')),
          stock_applied INTEGER NOT NULL DEFAULT 0 CHECK (stock_applied IN (0, 1)),
          created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

        CREATE TABLE IF NOT EXISTS order_items (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          order_id   INTEGER NOT NULL REFERENCES orders(id),
          product_id INTEGER NOT NULL REFERENCES products(id),
          quantity   INTEGER NOT NULL CHECK (quantity > 0),
          unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_order_items_order   ON order_items(order_id);
        CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);

        INSERT OR IGNORE INTO expense_categories (name) VALUES
          ('إيجار'), ('كهرباء وماء'), ('رواتب وأجور'), ('نقل وشحن'),
          ('صيانة'), ('ضرائب ورسوم'), ('مصاريف أخرى');
      `)
    }
  },
  {
    version: 5,
    name: 'price-history',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS price_history (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL REFERENCES products(id),
          field      TEXT NOT NULL CHECK (field IN ('purchase_price','sale_price','external_price')),
          old_value  INTEGER NOT NULL,
          new_value  INTEGER NOT NULL,
          changed_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history(product_id);
      `)
    }
  },
  {
    version: 6,
    name: 'sale-payment-ledger',
    up: (db) => {
      db.exec(`
        -- Ledger of actual payments received against sales invoices.
        -- sales.paid stays as the amount paid AT CHECKOUT TIME; cashReceived
        -- in reports is computed from this table so refunds can be recorded
        -- as negative entries without rewriting history.
        CREATE TABLE IF NOT EXISTS sale_payments (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          sale_id    INTEGER NOT NULL REFERENCES sales(id),
          amount     INTEGER NOT NULL CHECK (amount <> 0),
          note       TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_sale_payments_sale ON sale_payments(sale_id);
      `)
      // Backfill: every existing sale's checkout payment becomes a ledger entry.
      db.exec(`
        INSERT INTO sale_payments (sale_id, amount, note, created_at)
        SELECT s.id, s.paid, 'الدفع عند إنشاء الفاتورة', s.created_at
        FROM sales s WHERE s.paid > 0
        AND NOT EXISTS (SELECT 1 FROM sale_payments p WHERE p.sale_id = s.id);
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
    if (m.foreignKeysOff) db.pragma('foreign_keys = OFF')
    const apply = db.transaction(() => {
      m.up(db)
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(
        m.version,
        m.name
      )
    })
    try {
      apply()
    } finally {
      if (m.foreignKeysOff) db.pragma('foreign_keys = ON')
    }
  }

  // Seed runs inside its own transaction; INSERT OR IGNORE keeps it idempotent
  // so re-opening an existing database never duplicates or deletes data.
  db.transaction(seedCategories)(db)

  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(LATEST_SCHEMA_VERSION))
}

/** Reads a setting value; returns null when the key does not exist. */
export function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    { value: string } | undefined
  return row ? row.value : null
}

/** Creates the counter row if missing and returns its current numeric value. */
export function ensureCounter(db: Database.Database, key: string): number {
  db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, '0')`).run(key)
  return Number(getSetting(db, key) ?? '0')
}

/** Atomically increments a counter stored in `settings` and returns the new value. */
export function bumpCounter(db: Database.Database, key: string): number {
  const next = ensureCounter(db, key) + 1
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(next))
  return next
}

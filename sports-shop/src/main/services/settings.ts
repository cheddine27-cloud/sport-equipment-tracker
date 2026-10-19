/** Shop settings stored in the `settings` table (key/value). */
import type Database from 'better-sqlite3'
import type { ShopSettings } from '../../shared/types'
import { optionalText } from './validation'
import { getSetting } from '../db/migrations'
import { logAudit } from './audit'

const DEFAULTS: ShopSettings = {
  shopName: 'محل المستلزمات الرياضية',
  shopAddress: '',
  shopPhone: '',
  invoiceFooter: 'شكراً لتعاملكم معنا'
}

const KEYS: Array<[keyof ShopSettings, string]> = [
  ['shopName', 'shop_name'],
  ['shopAddress', 'shop_address'],
  ['shopPhone', 'shop_phone'],
  ['invoiceFooter', 'invoice_footer']
]

export function getShopSettings(db: Database.Database): ShopSettings {
  const out = { ...DEFAULTS }
  for (const [field, key] of KEYS) {
    const v = getSetting(db, key)
    if (v !== null) out[field] = v
  }
  return out
}

export function setShopSettings(db: Database.Database, input: Partial<ShopSettings>): ShopSettings {
  const up = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )
  const tx = db.transaction(() => {
    for (const [field, key] of KEYS) {
      const raw = input[field]
      if (raw === undefined) continue
      const clean = optionalText(raw, 'إعدادات المحل', 200) ?? DEFAULTS[field]
      up.run(key, clean)
    }
    logAudit(db, 'UPDATE_SETTINGS', 'settings', null, 'تحديث إعدادات المحل')
  })
  tx()
  return getShopSettings(db)
}

export function getPriceHistory(
  db: Database.Database,
  productId: number,
  limit = 100
): Array<{
  id: number
  productId: number
  field: 'purchase_price' | 'sale_price' | 'external_price'
  oldValue: number
  newValue: number
  changedAt: string
}> {
  const rows = db
    .prepare(
      'SELECT id, product_id, field, old_value, new_value, changed_at FROM price_history WHERE product_id = ? ORDER BY id DESC LIMIT ?'
    )
    .all(productId, limit) as Array<{
    id: number
    product_id: number
    field: 'purchase_price' | 'sale_price' | 'external_price'
    old_value: number
    new_value: number
    changed_at: string
  }>
  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    field: r.field,
    oldValue: r.old_value,
    newValue: r.new_value,
    changedAt: r.changed_at
  }))
}

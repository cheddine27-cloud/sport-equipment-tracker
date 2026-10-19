/**
 * Shared navigation definitions used by the renderer (sidebar) and, later,
 * by main-process modules (e.g. per-section database migrations / backups).
 * Keeping this in `src/shared` makes it importable from BOTH processes once
 * the SQLite layer is added in the next phase.
 */

export type ViewId =
  | 'dashboard'
  | 'products'
  | 'inventory'
  | 'sales'
  | 'exports-orders'
  | 'expenses-profits'
  | 'suppliers-debts'
  | 'reports'
  | 'backup'
  | 'users-settings'

export interface NavItem {
  id: ViewId
  /** Arabic label shown in the sidebar. */
  label: string
}

/** Sidebar order matches the specification of the application. */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'dashboard', label: 'لوحة التحكم' },
  { id: 'products', label: 'المنتجات' },
  { id: 'inventory', label: 'المخزون' },
  { id: 'sales', label: 'المبيعات' },
  { id: 'exports-orders', label: 'الصادرات والطلبات' },
  { id: 'expenses-profits', label: 'المصاريف والأرباح' },
  { id: 'suppliers-debts', label: 'الموردون والديون' },
  { id: 'reports', label: 'التقارير' },
  { id: 'backup', label: 'النسخ الاحتياطي' },
  { id: 'users-settings', label: 'المستخدمون والإعدادات' }
] as const

/** Application title (Arabic). */
export const APP_TITLE = 'نظام تسيير المستلزمات الرياضية'

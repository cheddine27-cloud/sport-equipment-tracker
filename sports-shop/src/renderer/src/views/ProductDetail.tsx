import { useEffect, useState } from 'react'
import type { Product, StockMovement } from '../../../shared/types'
import { formatDZD } from '../lib/format'
import { unwrap } from '../lib/db-client'
import { Alert, MOVEMENT_TYPE_LABELS, formatDateTime } from '../components/ui'

interface ProductDetailProps {
  product: Product
  categoryName: string
  onEdit: () => void
  onReceive: () => void
  onCorrect: () => void
  onToggleActive: () => void
}

/** Detail panel: full product data + audited stock movement history. */
function ProductDetail({
  product,
  categoryName,
  onEdit,
  onReceive,
  onCorrect,
  onToggleActive
}: ProductDetailProps): React.JSX.Element {
  const [movements, setMovements] = useState<StockMovement[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setMovements(null)
    setError(null)
    unwrap(window.desktop.stock.movementsForProduct(product.id))
      .then((m) => !cancelled && setMovements(m))
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [product.id])

  const low = product.quantity <= product.minStock

  const rows: Array<[string, string]> = [
    ['رمز المنتج (SKU)', product.code],
    ['الفئة', categoryName],
    ['المقاس', product.size ?? '—'],
    ['اللون', product.color ?? '—'],
    ['المادة / النوع', product.material ?? '—'],
    ['سعر الشراء', formatDZD(product.purchasePrice)],
    ['سعر البيع داخل المحل', formatDZD(product.salePrice)],
    ['سعر البيع الخارجي', formatDZD(product.externalPrice)],
    ['مرجع المورد', product.supplierRef ?? '—'],
    ['تاريخ الإنشاء', formatDateTime(product.createdAt)],
    ['آخر تحديث', formatDateTime(product.updatedAt)]
  ]

  return (
    <div className="detail">
      <div className="detail-head">
        <h3>{product.name}</h3>
        <span className={`badge ${product.active ? 'badge-ok' : 'badge-off'}`}>
          {product.active ? 'نشط' : 'غير نشط'}
        </span>
      </div>

      <div className="stock-summary">
        <div className={`stock-box${low ? ' low' : ''}`}>
          <span className="stock-num">{product.quantity}</span>
          <span className="stock-cap">الكمية في المخزون</span>
        </div>
        <div className="stock-min">حد التنبيه: {product.minStock}</div>
        {low && <div className="low-warning">تنبيه: الكمية بلغت حد التنبيه أو أقل</div>}
      </div>

      <dl className="kv-list">
        {rows.map(([k, val]) => (
          <div className="kv-row" key={k}>
            <dt>{k}</dt>
            <dd>{val}</dd>
          </div>
        ))}
      </dl>

      <div className="detail-actions">
        <button type="button" className="btn btn-primary" onClick={onReceive}>
          استلام دفعة
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCorrect}>
          تصحيح المخزون
        </button>
        <button type="button" className="btn btn-secondary" onClick={onEdit}>
          تعديل البيانات
        </button>
        <button type="button" className="btn btn-ghost" onClick={onToggleActive}>
          {product.active ? 'تعطيل المنتج' : 'إعادة تفعيل المنتج'}
        </button>
      </div>

      <h4 className="history-title">تاريخ حركات المخزون</h4>
      <Alert kind="error">{error}</Alert>
      {movements === null && !error ? (
        <p className="muted">جارٍ التحميل…</p>
      ) : movements && movements.length === 0 ? (
        <p className="muted">لا توجد حركات مخزون لهذا المنتج بعد.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>التاريخ والوقت</th>
              <th>النوع</th>
              <th>التغيير</th>
              <th>الرصيد بعده</th>
              <th>السبب / الملاحظة</th>
            </tr>
          </thead>
          <tbody>
            {movements?.map((m) => (
              <tr key={m.id}>
                <td>{formatDateTime(m.createdAt)}</td>
                <td>{MOVEMENT_TYPE_LABELS[m.movementType] ?? m.movementType}</td>
                <td className={m.quantityChange >= 0 ? 'pos' : 'neg'}>
                  {m.quantityChange > 0 ? `+${m.quantityChange}` : m.quantityChange}
                </td>
                <td>{m.balanceAfter}</td>
                <td>{m.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export default ProductDetail

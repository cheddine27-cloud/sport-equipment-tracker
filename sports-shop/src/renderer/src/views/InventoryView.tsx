import { useCallback, useEffect, useState } from 'react'
import type { StockMovementWithProduct } from '../../../shared/types'
import { unwrap } from '../lib/db-client'
import { Alert } from '../components/ui'
import { MOVEMENT_TYPE_LABELS, formatDateTime } from '../lib/format'

/** المخزون — recent stock movements across all products. */
function InventoryView(): React.JSX.Element {
  const [movements, setMovements] = useState<StockMovementWithProduct[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      setMovements(await unwrap(window.desktop.stock.movementsAll()))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    // Reset happens inside the async continuation to avoid a synchronous
    // state update during the effect body.
    void (async () => {
      await Promise.resolve()
      setMovements(null)
      await load()
    })()
  }, [load])

  return (
    <div className="view">
      <section className="card">
        <div className="card-head">
          <h3 className="card-title">آخر حركات المخزون</h3>
          <button type="button" className="btn btn-ghost" onClick={() => void load()}>
            تحديث
          </button>
        </div>
        <Alert kind="error">{error}</Alert>
        {movements === null && !error ? (
          <p className="muted">جارٍ التحميل…</p>
        ) : movements && movements.length === 0 ? (
          <p className="muted empty-hint">
            لا توجد حركات مخزون بعد. تُسجَّل الحركات تلقائياً عند إنشاء منتج برصيد افتتاحي، أو
            استلام دفعة، أو تصحيح مخزون من قسم «المنتجات».
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>التاريخ والوقت</th>
                <th>المنتج</th>
                <th>الرمز</th>
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
                  <td>{m.productName}</td>
                  <td dir="ltr" className="mono">
                    {m.productCode}
                  </td>
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
      </section>
    </div>
  )
}

export default InventoryView

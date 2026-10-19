import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Category, Product, ProductInput, ProductUpdate } from '../../../shared/types'
import { formatDZD } from '../lib/format'
import { unwrap } from '../lib/db-client'
import { Alert, ConfirmDialog, Modal } from '../components/ui'
import ProductForm from './ProductForm'
import ProductDetail from './ProductDetail'
import { CorrectStockDialog, ReceiveStockDialog } from './StockDialogs'

type Mode =
  | { kind: 'list' }
  | { kind: 'add' }
  | { kind: 'edit'; product: Product }
  | { kind: 'receive'; product: Product }
  | { kind: 'correct'; product: Product }

/** المنتجات — searchable, filterable list + add/edit/detail/stock dialogs. */
function ProductsView(): React.JSX.Element {
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Array<Product & { categoryName: string }>>([])
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [includeInactive, setIncludeInactive] = useState(false)
  const [mode, setMode] = useState<Mode>({ kind: 'list' })
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmToggle, setConfirmToggle] = useState<number | null>(null)

  // Keep the latest product row for the id being confirmed (avoids stale state).
  const confirmTarget = useMemo(
    () => products.find((p) => p.id === confirmToggle) ?? null,
    [products, confirmToggle]
  )

  const load = useCallback(async (): Promise<void> => {
    try {
      const [cats, prods] = await Promise.all([
        unwrap(window.desktop.categories.list()),
        unwrap(window.desktop.products.list({ search, categoryId, includeInactive }))
      ])
      setCategories(cats)
      setProducts(prods)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [search, categoryId, includeInactive])

  useEffect(() => {
    // Debounced reload on filter changes.
    const t = setTimeout(() => void load(), 200)
    return () => clearTimeout(t)
  }, [load])

  const selected = useMemo(
    () => products.find((p) => p.id === selectedId) ?? null,
    [products, selectedId]
  )

  async function handleSave(input: ProductInput | ProductUpdate): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      if ('openingQuantity' in input) {
        const created = await unwrap(window.desktop.products.create(input))
        setNotice(`تمت إضافة المنتج «${created.name}» بنجاح.`)
        setSelectedId(created.id)
      } else {
        const updated = await unwrap(window.desktop.products.update(input))
        setNotice(`تم حفظ تعديلات «${updated.name}».`)
        setSelectedId(updated.id)
      }
      setMode({ kind: 'list' })
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function doToggleActive(p: Product): Promise<void> {
    const label = p.active ? 'تعطيل' : 'إعادة تفعيل'
    setConfirmToggle(null)
    setBusy(true)
    try {
      const { quantity, categoryName, ...rest } = p as Product & {
        categoryName?: string
      }
      void quantity
      void categoryName
      await unwrap(window.desktop.products.update({ ...rest, active: !p.active }))
      setNotice(`تم ${label} «${p.name}».`)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const categoryOptions = categories.map((c) => (
    <option key={c.id} value={c.id}>
      {c.name}
    </option>
  ))

  return (
    <div className="view">
      <Alert kind="success">{notice}</Alert>

      <section className="card toolbar-card">
        <div className="toolbar">
          <input
            type="search"
            className="search"
            placeholder='بحث بالاسم أو الرمز… مثال: "قفاز"'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="بحث في المنتجات"
          />
          <select
            value={categoryId ?? ''}
            onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
            aria-label="تصفية حسب الفئة"
          >
            <option value="">كل الفئات</option>
            {categoryOptions}
          </select>
          <label className="check">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            إظهار غير النشطة
          </label>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setError(null)
              setMode({ kind: 'add' })
            }}
          >
            + منتج جديد
          </button>
        </div>
      </section>

      <div className="split">
        <section className="card">
          <Alert kind="error">{mode.kind === 'list' ? error : null}</Alert>
          {products.length === 0 ? (
            <p className="muted empty-hint">
              لا توجد منتجات مطابقة. قاعدة البيانات جاهزة — أضف أول منتج بزر «+ منتج جديد». (لا نضع
              بيانات وهمية عمداً.)
            </p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>الرمز</th>
                  <th>الاسم</th>
                  <th>الفئة</th>
                  <th>الكمية</th>
                  <th>سعر البيع</th>
                  <th>السعر الخارجي</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr
                    key={p.id}
                    className={`row-selectable${selectedId === p.id ? ' selected' : ''}`}
                    onClick={() => setSelectedId(p.id)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setSelectedId(p.id)}
                  >
                    <td dir="ltr" className="mono">
                      {p.code}
                    </td>
                    <td>{p.name}</td>
                    <td>{p.categoryName}</td>
                    <td className={p.quantity <= p.minStock ? 'low-qty' : ''}>{p.quantity}</td>
                    <td>{formatDZD(p.salePrice)}</td>
                    <td>{formatDZD(p.externalPrice)}</td>
                    <td>
                      <span className={`badge ${p.active ? 'badge-ok' : 'badge-off'}`}>
                        {p.active ? 'نشط' : 'معطّل'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card detail-pane">
          {selected ? (
            <ProductDetail
              product={selected}
              categoryName={selected.categoryName}
              onEdit={() => setMode({ kind: 'edit', product: selected })}
              onReceive={() => setMode({ kind: 'receive', product: selected })}
              onCorrect={() => setMode({ kind: 'correct', product: selected })}
              onToggleActive={() => setConfirmToggle(selected.id)}
            />
          ) : (
            <p className="muted">اختر منتجاً من القائمة لعرض تفاصيله وتاريخ حركاته.</p>
          )}
        </section>
      </div>

      {mode.kind === 'add' && (
        <Modal title="إضافة منتج جديد" onClose={() => setMode({ kind: 'list' })}>
          <ProductForm
            categories={categories}
            saving={busy}
            serverError={error}
            onSave={(i) => void handleSave(i)}
            onCancel={() => setMode({ kind: 'list' })}
          />
        </Modal>
      )}

      {mode.kind === 'edit' && (
        <Modal title="تعديل منتج" onClose={() => setMode({ kind: 'list' })}>
          <ProductForm
            categories={categories}
            initial={mode.product}
            saving={busy}
            serverError={error}
            onSave={(i) => void handleSave(i)}
            onCancel={() => setMode({ kind: 'list' })}
          />
        </Modal>
      )}

      {mode.kind === 'receive' && (
        <Modal title="استلام دفعة جديدة" onClose={() => setMode({ kind: 'list' })}>
          <ReceiveStockDialog
            product={mode.product}
            onDone={() => {
              setNotice('تم تسجيل استلام الدفعة وتحديث الرصيد.')
              setMode({ kind: 'list' })
              void load()
            }}
            onClose={() => setMode({ kind: 'list' })}
          />
        </Modal>
      )}

      {mode.kind === 'correct' && (
        <Modal title="تصحيح مخزون مرخّص" onClose={() => setMode({ kind: 'list' })}>
          <CorrectStockDialog
            product={mode.product}
            onDone={() => {
              setNotice('تم تسجيل تصحيح المخزون مع سببه في تاريخ الحركات.')
              setMode({ kind: 'list' })
              void load()
            }}
            onClose={() => setMode({ kind: 'list' })}
          />
        </Modal>
      )}

      {confirmTarget && (
        <ConfirmDialog
          title={confirmTarget.active ? 'تعطيل منتج' : 'إعادة تفعيل منتج'}
          message={`هل تريد ${confirmTarget.active ? 'تعطيل' : 'إعادة تفعيل'} المنتج «${confirmTarget.name}»؟ لن تُحذف أي بيانات أو سجل حركات.`}
          confirmLabel={confirmTarget.active ? 'تعطيل' : 'إعادة تفعيل'}
          onConfirm={() => void doToggleActive(confirmTarget)}
          onCancel={() => setConfirmToggle(null)}
        />
      )}
    </div>
  )
}

export default ProductsView

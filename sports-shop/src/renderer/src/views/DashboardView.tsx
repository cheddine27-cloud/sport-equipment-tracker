import type { ViewId } from '../../../shared/navigation'
import { formatDZD } from '../lib/format'

interface DashboardViewProps {
  onNavigate: (id: ViewId) => void
}

/**
 * Home screen. Deliberately shows NO business numbers — there is no data
 * source yet (SQLite arrives in the next phase). It only explains what the
 * dashboard will contain and links to the sections that will feed it.
 */
function DashboardView({ onNavigate }: DashboardViewProps): React.JSX.Element {
  return (
    <div className="view">
      <section className="hero card">
        <h2 className="hero-title">مرحباً بك في نظام تسيير المستلزمات الرياضية</h2>
        <p className="hero-text">
          هذا هو التطبيق الرئيسي لإدارة متجر المستلزمات الرياضية: المنتجات، المخزون، المبيعات،
          الصادرات والطلبات، المصاريف والأرباح، الموردون والديون، والتقارير — يعمل بالكامل دون اتصال
          بالإنترنت، وتُعرض كل المبالغ بالدينار الجزائري ({formatDZD(0)}).
        </p>
        <p className="hero-note">
          لم يتم ربط قاعدة البيانات بعد. ستُضاف لوحة الأرقام والبيانات الحقيقية في المرحلة القادمة.
        </p>
      </section>

      <section className="card">
        <h3 className="card-title">أقسام النظام</h3>
        <p className="card-hint">اختر قسماً من القائمة لبدء استكشاف الواجهة:</p>
        <div className="quick-grid">
          <button type="button" className="quick-card" onClick={() => onNavigate('products')}>
            <span className="quick-card-label">المنتجات</span>
            <span className="quick-card-desc">قائمة الأصناف والأسعار</span>
          </button>
          <button type="button" className="quick-card" onClick={() => onNavigate('sales')}>
            <span className="quick-card-label">المبيعات</span>
            <span className="quick-card-desc">فواتير ونقاط بيع</span>
          </button>
          <button type="button" className="quick-card" onClick={() => onNavigate('inventory')}>
            <span className="quick-card-label">المخزون</span>
            <span className="quick-card-desc">حركات الدخول والخروج</span>
          </button>
          <button type="button" className="quick-card" onClick={() => onNavigate('reports')}>
            <span className="quick-card-label">التقارير</span>
            <span className="quick-card-desc">إحصائيات ومطبوعات</span>
          </button>
        </div>
      </section>
    </div>
  )
}

export default DashboardView

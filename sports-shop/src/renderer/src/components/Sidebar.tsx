import { NAV_ITEMS, APP_TITLE, type ViewId } from '../../../shared/navigation'

interface SidebarProps {
  active: ViewId
  onSelect: (id: ViewId) => void
}

/**
 * Right-side navigation sidebar (right = "start" side in RTL layout).
 */
function Sidebar({ active, onSelect }: SidebarProps): React.JSX.Element {
  return (
    <nav className="sidebar" aria-label="التنقل الرئيسي">
      <div className="sidebar-brand">
        <div className="sidebar-logo" aria-hidden="true">
          ⚽
        </div>
        <span className="sidebar-title">{APP_TITLE}</span>
      </div>

      <ul className="sidebar-list">
        {NAV_ITEMS.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={`sidebar-item${active === item.id ? ' active' : ''}`}
              aria-current={active === item.id ? 'page' : undefined}
              onClick={() => onSelect(item.id)}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>

      <div className="sidebar-footer">نسخة تجريبية — المرحلة الأولى</div>
    </nav>
  )
}

export default Sidebar

import { useState } from 'react'
import { NAV_ITEMS, APP_TITLE, type ViewId } from '../../shared/navigation'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import DashboardView from './views/DashboardView'
import ProductsView from './views/ProductsView'
import InventoryView from './views/InventoryView'
import PlaceholderView from './views/PlaceholderView'

function App(): React.JSX.Element {
  const [activeView, setActiveView] = useState<ViewId>('dashboard')

  const activeItem = NAV_ITEMS.find((item) => item.id === activeView) ?? NAV_ITEMS[0]

  return (
    <div className="app-shell">
      <Sidebar active={activeView} onSelect={setActiveView} />
      <div className="app-main">
        <TopBar title={APP_TITLE} section={activeItem.label} />
        <main className="app-content">
          {activeView === 'dashboard' ? (
            <DashboardView onNavigate={setActiveView} />
          ) : activeView === 'products' ? (
            <ProductsView />
          ) : activeView === 'inventory' ? (
            <InventoryView />
          ) : (
            <PlaceholderView title={activeItem.label} />
          )}
        </main>
      </div>
    </div>
  )
}

export default App

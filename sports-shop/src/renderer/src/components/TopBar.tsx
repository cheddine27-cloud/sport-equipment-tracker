import { useEffect, useState } from 'react'

interface TopBarProps {
  /** Application title. */
  title: string
  /** Current section label. */
  section: string
}

/**
 * Header bar with the app title, current section and offline indicator.
 * The version is fetched through the explicit preload bridge
 * (`window.desktop.getAppMeta`) — no Node.js access in the renderer.
 */
function TopBar({ title, section }: TopBarProps): React.JSX.Element {
  const [appVersion, setAppVersion] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    window.desktop
      .getAppMeta()
      .then((meta) => {
        if (!cancelled) setAppVersion(meta.appVersion)
      })
      .catch(() => {
        /* metadata is non-critical; ignore */
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <header className="topbar">
      <div className="topbar-heading">
        <h1 className="topbar-title">{title}</h1>
        <span className="topbar-section">{section}</span>
      </div>
      <div className="topbar-status">
        <span className="badge badge-offline">يعمل دون اتصال</span>
        {appVersion && <span className="topbar-version">الإصدار {appVersion}</span>}
      </div>
    </header>
  )
}

export default TopBar

interface PlaceholderViewProps {
  /** Arabic section title. */
  title: string
}

/**
 * Neutral placeholder shown for every section until its real screens and
 * database-backed logic are implemented (next phases).
 */
function PlaceholderView({ title }: PlaceholderViewProps): React.JSX.Element {
  return (
    <div className="view">
      <section className="card placeholder-card">
        <h2 className="placeholder-title">{title}</h2>
        <p className="placeholder-text">
          هذه صفحة تجريبية لقسم «{title}». سيتم تطوير شاشات هذا القسم وربطها بقاعدة البيانات المحلية
          في المراحل القادمة.
        </p>
      </section>
    </div>
  )
}

export default PlaceholderView

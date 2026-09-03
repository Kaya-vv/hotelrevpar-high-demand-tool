export default function CalendarLoading() {
  return (
    <div>
      <div className="page-title-row">
        <header className="page-title">
          <span className="eyebrow">Vraagmomenten</span>
          <h1>
            <span className="skeleton skeleton-title" />
          </h1>
          <p>Alle relevante momenten met hun verwachte hotelvraag en score.</p>
        </header>
      </div>
      <div className="event-toolbar">
        <span className="skeleton skeleton-toolbar" />
        <span className="skeleton skeleton-toolbar" />
      </div>
      <div className="filter-bar">
        <span className="skeleton skeleton-field" />
        <span className="skeleton skeleton-field" />
      </div>
      <span className="skeleton skeleton-grid" aria-label="Kalender wordt geladen" />
    </div>
  );
}

export function ExportSkeleton() {
  return <div className="panel" role="status" aria-label="Exportgegevens laden" aria-busy="true">
    <span className="skeleton skeleton-title" />
    <span className="skeleton skeleton-line" />
    <span className="skeleton skeleton-panel" />
  </div>;
}

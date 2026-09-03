import type { ReactNode } from "react";

/**
 * Placeholder shell shown while a page's data resolves. Mirrors the real page
 * frame — eyebrow, heading, intro, then content blocks — so the swap to real
 * content does not shift the layout.
 */
export function PageSkeleton({ children }: { children?: ReactNode }) {
  return (
    <div aria-busy="true">
      <header className="page-title">
        <span className="skeleton skeleton-eyebrow" />
        <h1>
          <span className="skeleton skeleton-title" />
        </h1>
        <p>
          <span className="skeleton skeleton-line" />
        </p>
      </header>
      {children ?? (
        <>
          <span className="skeleton skeleton-panel" />
          <span className="skeleton skeleton-panel" />
        </>
      )}
    </div>
  );
}

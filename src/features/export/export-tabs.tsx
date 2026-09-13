"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

export function useExportView() {
  const params = useSearchParams();
  return params.get("view") ?? (params.has("historyPage") ? "history" : "new");
}

export function ExportTabs({ initialView, newHref, historyHref }: {
  initialView: string; newHref: string; historyHref: string;
}) {
  const view = useExportView();
  return <nav className="export-tabs" aria-label="Exportweergave">
    {[["new", "Nieuwe export", newHref], ["history", "Eerdere exports", historyHref]].map(([value, label, href]) =>
      <Link key={value} href={href} prefetch={false} aria-current={view === value ? "page" : undefined} onNavigate={(event) => {
        // Both views are already loaded. Re-export still needs its own server view.
        if (initialView === "reexport") return;
        event.preventDefault();
        if (view !== value) window.history.pushState(null, "", href);
      }}>{label}</Link>,
    )}
  </nav>;
}

export function ExportPanel({ history = false, children }: {
  history?: boolean; children: ReactNode;
}) {
  const view = useExportView();
  return <div hidden={history !== (view === "history")}>{children}</div>;
}

"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

type ExportTab = "new" | "history" | "settings";

export function useExportView() {
  const params = useSearchParams();
  return params.get("view") ?? (params.has("historyPage") ? "history" : "new");
}

/** The tab a view belongs to; re-export and unknown views show the export panel. */
function tabOf(view: string): ExportTab {
  return view === "history" || view === "settings" ? view : "new";
}

export function ExportTabs({ initialView, hrefs }: {
  initialView: string; hrefs: Record<ExportTab, string>;
}) {
  const active = tabOf(useExportView());
  const tabs: [ExportTab, string][] = [["new", "Nieuwe export"], ["history", "Eerdere exports"], ["settings", "Instellingen"]];
  return <nav className="export-tabs" aria-label="Exportweergave">
    {tabs.map(([value, label]) =>
      <Link key={value} href={hrefs[value]} prefetch={false} aria-current={active === value ? "page" : undefined} onNavigate={(event) => {
        // All views are already loaded. Re-export still needs its own server view.
        if (initialView === "reexport") return;
        event.preventDefault();
        if (active !== value) window.history.pushState(null, "", hrefs[value]);
      }}>{label}</Link>,
    )}
  </nav>;
}

export function ExportPanel({ tab = "new", children }: {
  tab?: ExportTab; children: ReactNode;
}) {
  return <div hidden={tab !== tabOf(useExportView())}>{children}</div>;
}

/** True on the settings tab, where the hotel and period filter does not apply. */
export function useSettingsTab() {
  return tabOf(useExportView()) === "settings";
}

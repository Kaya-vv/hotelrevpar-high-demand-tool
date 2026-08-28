import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { RefreshButton } from "./refresh-button";

const links: Array<[string, string]> = [
  ["/calendar", "Vraagkalender"],
  ["/review", "Te beoordelen"],
  ["/portfolio", "Hotels"],
  ["/export", "Exporteren"],
  ["/account", "Account"],
];

type AppShellProps = {
  accountName: string;
  children: ReactNode;
  refreshAction?: () => void | Promise<void>;
  isPlatformAdmin?: boolean;
};

export function AppShell({ accountName, children, refreshAction, isPlatformAdmin = false }: AppShellProps) {
  const navigation = isPlatformAdmin
    ? [...links, ["/admin/accounts", "Abonnees"] as [string, string], ["/admin/source-health", "Bronstatus"] as [string, string]]
    : links;
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link className="brand" href="/calendar" aria-label="HotelRevPar vraagkalender">
          <Image src="/logo.webp" alt="HotelRevPar" width={180} height={131} priority />
          <span>High Demand Tool</span>
        </Link>
        <nav aria-label="Hoofdnavigatie">
          {navigation.map(([href, label]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="workspace">
        <header className="workspace-header">
          <div>
            <span className="eyebrow">Actief account</span>
            <strong>{accountName}</strong>
          </div>
          <form action={refreshAction}>
            <RefreshButton />
          </form>
        </header>
        <div className="workspace-content">{children}</div>
      </main>
    </div>
  );
}

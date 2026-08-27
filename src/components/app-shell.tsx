import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

const links = [
  ["/calendar", "Vraagkalender"],
  ["/review", "Te beoordelen"],
  ["/portfolio", "Hotels & regio's"],
  ["/export", "Exporteren"],
  ["/account", "Account"],
] as const;

type AppShellProps = {
  accountName: string;
  children: ReactNode;
  refreshAction?: () => void | Promise<void>;
};

export function AppShell({ accountName, children, refreshAction }: AppShellProps) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link className="brand" href="/calendar" aria-label="HotelRevPar vraagkalender">
          <Image src="/logo.webp" alt="HotelRevPar" width={180} height={131} priority />
          <span>High Demand Tool</span>
        </Link>
        <nav aria-label="Hoofdnavigatie">
          {links.map(([href, label]) => (
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
            <button className="primary" type="submit">
              Nu verversen
            </button>
          </form>
        </header>
        <div className="workspace-content">{children}</div>
      </main>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const mainLinks = [
  ["/calendar", "Kalender"],
  ["/portfolio", "Hotels"],
  ["/export", "Exporteren"],
  ["/account", "Account"],
] as const;

const adminLinks = [
  ["/admin/accounts", "Abonnees"],
  ["/admin/source-health", "Bronstatus"],
  ["/review", "Datakwaliteit"],
] as const;

export function AppNavigation({
  isPlatformAdmin,
  reviewCount,
}: {
  isPlatformAdmin: boolean;
  reviewCount: number;
}) {
  const pathname = usePathname();
  const links = (items: typeof mainLinks | typeof adminLinks) =>
    items.map(([href, label]) => (
      <Link
        key={href}
        href={href}
        aria-current={pathname.startsWith(href) ? "page" : undefined}
      >
        <span>{label}</span>
        {href === "/review" && reviewCount > 0 && (
          <span className="nav-badge">{reviewCount}</span>
        )}
      </Link>
    ));

  return (
    <nav aria-label="Hoofdnavigatie">
      <div className="nav-group">{links(mainLinks)}</div>
      {isPlatformAdmin && (
        <div className="nav-group admin-nav">
          <span className="nav-heading">Platformbeheer</span>
          {links(adminLinks)}
        </div>
      )}
    </nav>
  );
}

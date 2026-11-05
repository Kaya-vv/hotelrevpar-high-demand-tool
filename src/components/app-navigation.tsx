"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const mainLinks = [
  ["/calendar", "Overzicht"],
  ["/portfolio", "Hotels"],
  ["/export", "Exporteren"],
  ["/account", "Account"],
] as const;

const adminLinks = [
  ["/admin/accounts", "Abonnees"],
  ["/admin/source-health", "Bronstatus"],
  ["/admin/venue-calendars", "Zaalagenda’s"],
] as const;

export function AppNavigation({
  isPlatformAdmin,
}: {
  isPlatformAdmin: boolean;
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

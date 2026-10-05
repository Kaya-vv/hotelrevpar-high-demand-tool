import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { AppNavigation } from "@/components/app-navigation";
import { trialDaysLeft } from "@/features/accounts/trial";
import { StatusMonitor } from "@/features/collection/status-monitor";
import type { CollectionStatus } from "@/features/collection/status";
import { HotelSwitcher } from "@/components/hotel-switcher";
import { selectHotel, stopViewingOtherAccount } from "@/features/workspace/actions";
import type { SelectableHotel } from "@/features/workspace/hotel-context";
import type { BatchProgress } from "@/features/workspace/query";

type AppShellProps = {
  accountName: string;
  children: ReactNode;
  isPlatformAdmin?: boolean;
  hotels: SelectableHotel[];
  selectedHotelId: string | null;
  reviewCount: number;
  batch: BatchProgress | null;
  collectionStatus?: CollectionStatus;
  /** The platform administrator is looking at a subscriber's hotel: reading only. */
  viewingOtherAccount?: boolean;
  /** Set while the viewed account is on a free trial. */
  trialEndsAt?: string | null;
  /** Where the paid package is bought; the banner links to it when set. */
  checkoutUrl?: string | null;
};

export function AppShell({
  accountName,
  children,
  isPlatformAdmin = false,
  hotels,
  selectedHotelId,
  reviewCount,
  batch,
  collectionStatus,
  viewingOtherAccount = false,
  trialEndsAt = null,
  checkoutUrl = null,
}: AppShellProps) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link
          className="brand"
          href="/calendar"
          aria-label="DemandRadar kalender"
        >
          <Image
            src="/DemandRadar-Logo.png"
            alt="DemandRadar"
            width={180}
            height={120}
            priority
          />
        </Link>
        <AppNavigation
          isPlatformAdmin={isPlatformAdmin}
          reviewCount={reviewCount}
        />
      </aside>
      <main className="workspace">
        <header className="workspace-header">
          <div className="workspace-identity">
            <div className="account-context">
              <span className="eyebrow">
                {viewingOtherAccount ? "Meekijken bij" : "Actief account"}
              </span>
              <strong>{accountName}</strong>
            </div>
            {viewingOtherAccount && (
              <form action={stopViewingOtherAccount}>
                <button className="secondary" type="submit">
                  Terug naar mijn eigen hotels
                </button>
              </form>
            )}
          </div>
          <HotelSwitcher
            hotels={hotels}
            selectedHotelId={selectedHotelId}
            action={selectHotel}
          />
        </header>
        {trialEndsAt && (
          <p className="notice warning trial-banner">
            Proefperiode: nog {trialDaysLeft(trialEndsAt)} dagen. Je ziet events tot 90 dagen vooruit.
            {checkoutUrl && <> <a href={checkoutUrl}>Abonnement afsluiten</a></>}
          </p>
        )}
        <StatusMonitor initial={collectionStatus ?? { batch, pending: Boolean(batch?.active), revision: "", watchKey: batch?.batchId ?? "" }}>
          <div className="workspace-content">{children}</div>
        </StatusMonitor>
      </main>
    </div>
  );
}

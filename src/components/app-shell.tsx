import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { AppNavigation } from "@/components/app-navigation";
import { StatusMonitor } from "@/features/collection/status-monitor";
import type { CollectionStatus } from "@/features/collection/status";
import { HotelSwitcher } from "@/components/hotel-switcher";
import { selectHotel } from "@/features/workspace/actions";
import type { BatchProgress } from "@/features/workspace/query";

type AppShellProps = {
  accountName: string;
  children: ReactNode;
  isPlatformAdmin?: boolean;
  hotels: Array<{ id: string; name: string }>;
  selectedHotelId: string | null;
  reviewCount: number;
  batch: BatchProgress | null;
  collectionStatus?: CollectionStatus;
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
          <div className="account-context">
            <span className="eyebrow">Actief account</span>
            <strong>{accountName}</strong>
          </div>
          <HotelSwitcher
            hotels={hotels}
            selectedHotelId={selectedHotelId}
            action={selectHotel}
          />
        </header>
        <StatusMonitor initial={collectionStatus ?? { batch, pending: Boolean(batch?.active), revision: "", watchKey: batch?.batchId ?? "" }}>
          <div className="workspace-content">{children}</div>
        </StatusMonitor>
      </main>
    </div>
  );
}

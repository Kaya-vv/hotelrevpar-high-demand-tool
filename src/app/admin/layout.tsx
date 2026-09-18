import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { listSelectableHotels } from "@/features/workspace/hotel-context";
import { getWorkspaceData } from "@/features/workspace/query";
import { requireViewedAccount } from "@/features/workspace/viewed-account";
import { requirePlatformAdmin } from "@/lib/auth/require-account";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requirePlatformAdmin();
  const account = await requireViewedAccount();
  const [workspace, hotels] = await Promise.all([
    getWorkspaceData(account.viewedAccountId),
    listSelectableHotels(account),
  ]);
  return <AppShell accountName={account.viewedAccountName} isPlatformAdmin hotels={hotels} selectedHotelId={workspace.selectedHotelId}
      reviewCount={account.viewingOtherAccount ? 0 : workspace.reviewCount} batch={workspace.batch}
      collectionStatus={workspace.collectionStatus} viewingOtherAccount={account.viewingOtherAccount}>{children}</AppShell>;
}

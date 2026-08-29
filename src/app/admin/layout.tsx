import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { getWorkspaceData } from "@/features/workspace/query";
import { requirePlatformAdmin } from "@/lib/auth/require-account";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const account = await requirePlatformAdmin();
  const workspace = await getWorkspaceData(account.accountId);
  return <AppShell accountName={account.accountName} isPlatformAdmin hotels={workspace.hotels} selectedHotelId={workspace.selectedHotelId} reviewCount={workspace.reviewCount} batch={workspace.batch}>{children}</AppShell>;
}

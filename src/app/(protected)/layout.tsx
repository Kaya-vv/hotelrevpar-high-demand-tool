import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { getWorkspaceData } from "@/features/workspace/query";
import { requireAccount } from "@/lib/auth/require-account";

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const account = await requireAccount();
  const workspace = await getWorkspaceData(account.accountId);
  return (
    <AppShell
      accountName={account.accountName}
      isPlatformAdmin={account.role === "platform_admin"}
      hotels={workspace.hotels}
      selectedHotelId={workspace.selectedHotelId}
      reviewCount={workspace.reviewCount}
      batch={workspace.batch}
    >
      {children}
    </AppShell>
  );
}

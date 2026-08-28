import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { requirePlatformAdmin } from "@/lib/auth/require-account";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const account = await requirePlatformAdmin();
  return <AppShell accountName={account.accountName} isPlatformAdmin>{children}</AppShell>;
}

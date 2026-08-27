import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { requireAccount } from "@/lib/auth/require-account";

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const account = await requireAccount();
  return <AppShell accountName={account.accountName}>{children}</AppShell>;
}


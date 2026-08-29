import { redirect } from "next/navigation";

import { createServerClient } from "@/lib/supabase/server";

export type CurrentAccount = {
  accountId: string;
  accountName: string;
  role: "operator" | "platform_admin";
  userId: string;
};

export async function requireAccount(): Promise<CurrentAccount> {
  const supabase = await createServerClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (!userId) redirect("/login");

  const { data: membership } = await supabase
    .from("account_members")
    .select("account_id, role")
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) redirect("/login?error=account");

  const { data: account } = await supabase
    .from("accounts")
    .select("name")
    .eq("id", membership.account_id)
    .eq("active", true)
    .maybeSingle();

  if (!account) redirect("/login?error=account");

  return {
    accountId: membership.account_id,
    accountName: account.name,
    role: membership.role,
    userId,
  } as CurrentAccount;
}

export async function requirePlatformAdmin() {
  const account = await requireAccount();
  if (account.role !== "platform_admin") redirect("/calendar");
  return account;
}

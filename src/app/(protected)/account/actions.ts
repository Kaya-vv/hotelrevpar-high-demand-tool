"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  baselineMemberNotifications,
  disableMemberNotifications,
} from "@/features/notifications/service";
import { requireAccount } from "@/lib/auth/require-account";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

export async function logout() {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function updateEventNotifications(formData: FormData) {
  const { accountId, userId } = await requireAccount();
  const enabled = formData.get("enabled") === "true";
  const admin = createAdminClient();
  const { data: current, error: readError } = await admin
    .from("account_members")
    .select("event_notifications_enabled")
    .eq("account_id", accountId)
    .eq("user_id", userId)
    .single();
  if (readError) throw readError;
  if (current.event_notifications_enabled === enabled) return;

  if (enabled) await baselineMemberNotifications(accountId, userId, admin);
  const { error: updateError } = await admin
    .from("account_members")
    .update({ event_notifications_enabled: enabled })
    .eq("account_id", accountId)
    .eq("user_id", userId);
  if (updateError) throw updateError;
  if (!enabled) await disableMemberNotifications(accountId, userId, admin);
  revalidatePath("/account");
}


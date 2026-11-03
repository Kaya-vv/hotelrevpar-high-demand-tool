"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  baselineMemberNotifications,
  disableMemberNotifications,
} from "@/features/notifications/service";
import { generateApiKey } from "@/features/public-api/keys";
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

export type ApiKeyState = { key?: string; error?: string };

export async function createApiKey(_state: ApiKeyState, formData: FormData): Promise<ApiKeyState> {
  const { accountId, userId } = await requireAccount();
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 60) return { error: "Geef de sleutel een naam van maximaal 60 tekens." };
  const { key, prefix, hash } = generateApiKey();
  const { error } = await createAdminClient().from("api_keys")
    .insert({ account_id: accountId, name, key_prefix: prefix, key_hash: hash, created_by: userId });
  if (error) throw error;
  revalidatePath("/account");
  return { key };
}

export async function revokeApiKey(formData: FormData) {
  const { accountId } = await requireAccount();
  const id = String(formData.get("id"));
  const { error } = await createAdminClient().from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id).eq("account_id", accountId).is("revoked_at", null);
  if (error) throw error;
  revalidatePath("/account");
}


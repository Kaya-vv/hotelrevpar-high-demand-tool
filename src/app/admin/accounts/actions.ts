"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { provisionSubscriberAccount } from "@/features/accounts/provision-subscriber-supabase";
import { SELECTED_HOTEL_COOKIE } from "@/features/workspace/hotel-context";
import { requirePlatformAdmin } from "@/lib/auth/require-account";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";

class AccountActionError extends Error {}

async function runAccountAction(success: string, operation: () => Promise<void>) {
  let notice = success;
  try {
    await operation();
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
    notice = error instanceof AccountActionError ? error.message
      : code === "email_exists" || code === "user_already_exists" ? "existing"
      : code === "over_email_send_rate_limit" || code === "over_request_rate_limit" ? "rate"
      : "failed";
    // Do not log email addresses, links, tokens or form contents.
    console.error("Subscriber action failed", { operation: success, code, notice });
  }
  revalidatePath("/admin/accounts");
  redirect(`/admin/accounts?notice=${notice}`);
}

function passwordRedirect() {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) throw new Error("NEXT_PUBLIC_SITE_URL ontbreekt.");
  return new URL("/auth/confirm?next=/auth/set-password", siteUrl).toString();
}

async function subscriberMember(admin: AdminClient, formData: FormData, currentUserId: string) {
  const userId = String(formData.get("userId") ?? "");
  const accountId = String(formData.get("accountId") ?? "");
  if (!userId || !accountId) throw new AccountActionError("missing");
  const { data, error } = await admin.from("account_members")
    .select("user_id, role").eq("account_id", accountId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new AccountActionError("missing");
  if (data.role === "platform_admin" || data.user_id === currentUserId) throw new AccountActionError("protected");
  return data;
}

async function activeAccount(admin: AdminClient, accountId: string) {
  const { data, error } = await admin.from("accounts").select("id, active").eq("id", accountId).maybeSingle();
  if (error) throw error;
  if (!data) throw new AccountActionError("missing");
  if (!data.active) throw new AccountActionError("inactive");
}

function parseHotelLimit(value: FormDataEntryValue | null): number | null {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 0) throw new AccountActionError("limit-input");
  return limit;
}

export async function createSubscriberAccount(formData: FormData) {
  await requirePlatformAdmin();
  return runAccountAction("invited", async () => {
    const accountName = String(formData.get("accountName") ?? "").trim();
    const accountId = String(formData.get("accountId") ?? "");
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    if ((!accountId && !accountName) || !z.email().safeParse(email).success) throw new AccountActionError("input");
    const hotelLimit = parseHotelLimit(formData.get("hotelLimit"));
    const redirectTo = passwordRedirect();
    const admin = createAdminClient();
    if (accountId) await activeAccount(admin, accountId);
    await provisionSubscriberAccount(admin, {
      accountName, email, accountId: accountId || undefined, hotelLimit, redirectTo,
    });
  });
}

export async function setAccountHotelLimit(formData: FormData) {
  await requirePlatformAdmin();
  return runAccountAction("limit-saved", async () => {
    const accountId = String(formData.get("accountId") ?? "");
    if (!accountId) throw new AccountActionError("missing");
    const limit = parseHotelLimit(formData.get("hotelLimit"));
    const admin = createAdminClient();
    const { data, error } = await admin.from("accounts")
      .update({ hotel_limit: limit }).eq("id", accountId).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new AccountActionError("missing");
  });
}

export async function resendSubscriberLink(formData: FormData) {
  const current = await requirePlatformAdmin();
  return runAccountAction("resent", async () => {
    const admin = createAdminClient();
    const member = await subscriberMember(admin, formData, current.userId);
    await activeAccount(admin, String(formData.get("accountId")));
    const { data, error } = await admin.auth.admin.getUserById(member.user_id);
    if (error) throw error;
    if (!data.user?.email) throw new AccountActionError("missing");
    const result = await admin.auth.resetPasswordForEmail(data.user.email, { redirectTo: passwordRedirect() });
    if (result.error) throw result.error;
  });
}

export async function deleteSubscriberUser(formData: FormData) {
  const current = await requirePlatformAdmin();
  return runAccountAction("deleted", async () => {
    const admin = createAdminClient();
    const member = await subscriberMember(admin, formData, current.userId);
    // The database removes membership with the auth user. Account data stays.
    const { error } = await admin.auth.admin.deleteUser(member.user_id);
    if (error) throw error;
  });
}

export async function setSubscriberHotelArchived(formData: FormData) {
  await requirePlatformAdmin();
  const archived = formData.get("archived");
  return runAccountAction(archived === "true" ? "hotel-archived" : "hotel-restored", async () => {
    const hotelId = String(formData.get("hotelId") ?? "");
    const accountId = String(formData.get("accountId") ?? "");
    if (!hotelId || !accountId || !["true", "false"].includes(String(archived))) throw new AccountActionError("hotel-input");
    const admin = createAdminClient();
    // Use the existing archive operation, including cancellation of queued work.
    // No membership is required: retained hotels still need managing after login deletion.
    const { data, error } = await admin.from("hotels")
      .update({ archived_at: archived === "true" ? new Date().toISOString() : null })
      .eq("account_id", accountId).eq("id", hotelId).select("id").maybeSingle();
    if (error?.message?.includes("hotel_limit_reached")) throw new AccountActionError("hotel-limit");
    if (error) throw error;
    if (!data) throw new AccountActionError("hotel-missing");
    const jar = await cookies();
    if (archived === "true" && jar.get(SELECTED_HOTEL_COOKIE)?.value === hotelId) jar.delete(SELECTED_HOTEL_COOKIE);
    revalidatePath("/", "layout");
  });
}

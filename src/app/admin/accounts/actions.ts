"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { provisionSubscriber } from "@/features/accounts/provision-subscriber";
import { baselineMemberNotifications } from "@/features/notifications/service";
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

export async function createSubscriberAccount(formData: FormData) {
  await requirePlatformAdmin();
  return runAccountAction("invited", async () => {
    const accountName = String(formData.get("accountName") ?? "").trim();
    const accountId = String(formData.get("accountId") ?? "");
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    if ((!accountId && !accountName) || !z.email().safeParse(email).success) throw new AccountActionError("input");
    const redirectTo = passwordRedirect();
    const admin = createAdminClient();
    if (accountId) await activeAccount(admin, accountId);

    await provisionSubscriber({ accountName, email }, {
      inviteUser: async (inviteEmail) => {
        // Reserve a NEW identity first. Re-inviting an existing unconfirmed user
        // must never reach provisioning rollback and delete their existing login.
        const created = await admin.auth.admin.createUser({ email: inviteEmail, email_confirm: false });
        if (created.error || !created.data.user) throw created.error ?? new Error("User creation failed");
        const userId = created.data.user.id;
        const invited = await admin.auth.admin.inviteUserByEmail(inviteEmail, { redirectTo });
        if (invited.error) {
          const removed = await admin.auth.admin.deleteUser(userId);
          if (removed.error) throw removed.error;
          throw invited.error;
        }
        return userId;
      },
      createAccount: async ({ accountName: name, userId }) => {
        let targetId = accountId;
        if (!targetId) {
          const { data, error } = await admin.from("accounts").insert({ name }).select("id").single();
          if (error) throw error;
          targetId = data.id;
        }
        const { error } = await admin.from("account_members").insert({
          account_id: targetId,
          user_id: userId,
          event_notifications_enabled: false,
        });
        if (error) {
          if (!accountId) {
            const cleanup = await admin.from("accounts").delete().eq("id", targetId);
            if (cleanup.error) throw cleanup.error;
          }
          throw error;
        }
        try {
          await baselineMemberNotifications(targetId, userId, admin);
          const enabled = await admin.from("account_members")
            .update({ event_notifications_enabled: true })
            .eq("account_id", targetId)
            .eq("user_id", userId);
          if (enabled.error) throw enabled.error;
        } catch (notificationError) {
          const membershipCleanup = await admin.from("account_members")
            .delete().eq("account_id", targetId).eq("user_id", userId);
          if (membershipCleanup.error) throw membershipCleanup.error;
          if (!accountId) {
            const accountCleanup = await admin.from("accounts").delete().eq("id", targetId);
            if (accountCleanup.error) throw accountCleanup.error;
          }
          throw notificationError;
        }
      },
      removeUser: async (userId) => {
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) throw error;
      },
    });
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
    if (error) throw error;
    if (!data) throw new AccountActionError("hotel-missing");
    const jar = await cookies();
    if (archived === "true" && jar.get(SELECTED_HOTEL_COOKIE)?.value === hotelId) jar.delete(SELECTED_HOTEL_COOKIE);
    revalidatePath("/", "layout");
  });
}

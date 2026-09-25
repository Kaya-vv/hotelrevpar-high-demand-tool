import "server-only";

import { baselineMemberNotifications } from "@/features/notifications/service";
import type { AdminClient } from "@/lib/supabase/admin";

import { provisionSubscriber } from "./provision-subscriber";

export type ProvisionAccountInput = {
  accountName: string;
  email: string;
  /** Add the login to this existing account instead of creating one. */
  accountId?: string;
  /** How many hotels the new account may run. `null` means no limit. */
  hotelLimit?: number | null;
  plugandpaySubscriptionId?: string | null;
  redirectTo: string;
};

/** Creates the login, the account and the membership, and returns the account id. */
export async function provisionSubscriberAccount(
  admin: AdminClient,
  input: ProvisionAccountInput,
): Promise<string> {
  const { accountId, redirectTo } = input;
  let resolvedId = accountId ?? "";

  await provisionSubscriber({ accountName: input.accountName, email: input.email }, {
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
        const { data, error } = await admin.from("accounts").insert({
          name,
          hotel_limit: input.hotelLimit ?? null,
          plugandpay_subscription_id: input.plugandpaySubscriptionId ?? null,
        }).select("id").single();
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
      resolvedId = targetId;
    },
    removeUser: async (userId) => {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw error;
    },
  });

  return resolvedId;
}

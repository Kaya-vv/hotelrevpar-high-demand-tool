import { provisionSubscriberAccount } from "@/features/accounts/provision-subscriber-supabase";
import { fetchPlugAndPayOrder } from "@/features/billing/plugandpay/client";
import { createPlugAndPayWebhookHandler } from "@/features/billing/plugandpay/webhook";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ontbreekt.`);
  return value;
}

export async function POST(request: Request) {
  // The webhook has no login session, so it writes with the service role.
  const admin = createAdminClient();
  return createPlugAndPayWebhookHandler({
    webhookKey: process.env.PLUGANDPAY_WEBHOOK_KEY,
    hotelProductIds: (process.env.PLUGANDPAY_HOTEL_PRODUCT_IDS ?? "")
      .split(",").map((part) => part.trim()).filter(Boolean).map(Number).filter(Number.isInteger),
    allowTestMode: process.env.PLUGANDPAY_TEST_MODE === "enabled",
    fetchOrder: (orderId) => fetchPlugAndPayOrder(orderId, requiredEnv("PLUGANDPAY_API_TOKEN")),
    claimEvent: async ({ key, triggerType, triggerableId }) => {
      const inserted = await admin.from("plugandpay_events").insert({
        event_key: key, trigger_type: triggerType, triggerable_id: triggerableId, status: "processing",
      });
      if (!inserted.error) return "claimed";
      if (inserted.error.code !== "23505") throw inserted.error;
      // A delivery that failed earlier (for example during an outage) may be tried again.
      const retried = await admin.from("plugandpay_events")
        .update({ status: "processing", detail: null, updated_at: new Date().toISOString() })
        .eq("event_key", key).eq("status", "failed").select("event_key");
      if (retried.error) throw retried.error;
      return retried.data.length ? "claimed" : "duplicate";
    },
    finishEvent: async ({ key, status, detail, accountId }) => {
      const { error } = await admin.from("plugandpay_events").update({
        status, detail: detail ?? null, account_id: accountId ?? null, updated_at: new Date().toISOString(),
      }).eq("event_key", key);
      if (error) throw error;
    },
    findAccountByEmail: async (email) => {
      const { data, error } = await admin.rpc("account_for_billing_email", { target: email });
      if (error) throw error;
      return data ?? null;
    },
    applyPurchase: async (input) => {
      if (input.accountId) {
        // `active: true` switches an account back on when a cancelled buyer purchases again.
        const { error } = await admin.from("accounts").update({
          hotel_limit: input.hotelLimit,
          active: true,
          ...(input.subscriptionId ? { plugandpay_subscription_id: input.subscriptionId } : {}),
        }).eq("id", input.accountId);
        if (error) throw error;
        return input.accountId;
      }
      return provisionSubscriberAccount(admin, {
        accountName: input.accountName,
        email: input.email,
        hotelLimit: input.hotelLimit,
        plugandpaySubscriptionId: input.subscriptionId,
        purchased: true,
        // The same set-password link the admin page sends.
        redirectTo: new URL("/auth/confirm?next=/auth/set-password", requiredEnv("NEXT_PUBLIC_SITE_URL")).toString(),
      });
    },
    endSubscription: async (subscriptionId) => {
      const { data, error } = await admin.from("accounts")
        .update({ active: false }).eq("plugandpay_subscription_id", subscriptionId).select("id");
      if (error) throw error;
      return data.length ? "deactivated" : "unknown";
    },
  })(request);
}

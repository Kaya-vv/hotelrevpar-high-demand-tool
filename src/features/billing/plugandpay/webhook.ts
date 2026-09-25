import { createHmac, timingSafeEqual } from "node:crypto";

import type { PlugAndPayOrder } from "./client";

export type PurchaseInput = {
  accountId: string | null;
  accountName: string;
  email: string;
  hotelLimit: number;
  subscriptionId: string | null;
};

export type PlugAndPayWebhookDependencies = {
  webhookKey: string | undefined;
  hotelProductIds: number[];
  allowTestMode: boolean;
  fetchOrder: (orderId: string) => Promise<PlugAndPayOrder>;
  /** Inserts the claim row. Returns "duplicate" when this message was already handled. */
  claimEvent: (input: { key: string; triggerType: string; triggerableId: string }) => Promise<"claimed" | "duplicate">;
  finishEvent: (input: { key: string; status: "done" | "ignored" | "failed"; detail?: string; accountId?: string }) => Promise<void>;
  findAccountByEmail: (email: string) => Promise<string | null>;
  applyPurchase: (input: PurchaseInput) => Promise<string>;
  endSubscription: (subscriptionId: string) => Promise<"deactivated" | "unknown">;
};

function validSignature(raw: string, signature: string, key: string) {
  const expected = Buffer.from(createHmac("sha256", key).update(raw).digest("hex"));
  const received = Buffer.from(signature);
  // timingSafeEqual throws on unequal lengths.
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function readTrigger(raw: string) {
  try {
    const body = JSON.parse(raw);
    // The help article puts these at the top level; the API reference nests them under `event`.
    const event = body?.event ?? body;
    const triggerType = event?.trigger_type;
    const triggerableId = event?.triggerable_id;
    if ((typeof triggerType !== "string" || !triggerType)
      || (typeof triggerableId !== "string" && typeof triggerableId !== "number")
      || String(triggerableId) === "") return null;
    return { triggerType, triggerableId: String(triggerableId) };
  } catch {
    return null;
  }
}

export function createPlugAndPayWebhookHandler(dependencies: PlugAndPayWebhookDependencies) {
  return async (request: Request): Promise<Response> => {
    // The signature covers the raw body, so read it before any parsing.
    const raw = await request.text();
    const key = dependencies.webhookKey;
    if (!key) return Response.json({ error: "not_configured" }, { status: 500 });
    if (!validSignature(raw, request.headers.get("x-signature") ?? "", key)) {
      return Response.json({ error: "invalid_signature" }, { status: 401 });
    }
    // A 4xx stops Plug&Pay retrying a body that will never become valid.
    const trigger = readTrigger(raw);
    if (!trigger) return Response.json({ error: "invalid_payload" }, { status: 400 });
    const { triggerType, triggerableId } = trigger;

    const eventKey = `${triggerType}:${triggerableId}`;
    const claim = await dependencies.claimEvent({ key: eventKey, triggerType, triggerableId });
    if (claim === "duplicate") return Response.json({ status: "duplicate" });

    const ignore = async (detail: string) => {
      await dependencies.finishEvent({ key: eventKey, status: "ignored", detail });
      return Response.json({ status: "ignored", detail });
    };

    try {
      if (triggerType === "order_payment_completed") {
        const order = await dependencies.fetchOrder(triggerableId);
        if (order.mode === "test" && !dependencies.allowTestMode) return await ignore("test_mode");
        if (order.payment?.status !== "paid") return await ignore("not_paid");
        // Only DemandRadar products grant hotels; Robert's other products never create accounts.
        const items = order.items.filter((item) => dependencies.hotelProductIds.includes(item.product_id));
        if (!items.length) return await ignore("no_hotel_product");
        const hotelLimit = items.reduce((total, item) => total + item.quantity, 0);
        if (hotelLimit === 0) return await ignore("zero_quantity");
        const contact = order.billing?.contact;
        const email = contact?.email?.trim().toLowerCase();
        // A paid order without an email needs attention, so fail loudly.
        if (!email) throw new Error("no_billing_email");
        const subscription = items.find((item) => item.subscription)?.subscription;
        const accountName = contact?.company?.trim()
          || `${contact?.firstname ?? ""} ${contact?.lastname ?? ""}`.trim()
          || email;
        const accountId = await dependencies.findAccountByEmail(email);
        const resolved = await dependencies.applyPurchase({
          accountId,
          accountName,
          email,
          hotelLimit,
          subscriptionId: subscription ? String(subscription.id) : null,
        });
        await dependencies.finishEvent({ key: eventKey, status: "done", accountId: resolved });
        return Response.json({ status: "provisioned", hotels: hotelLimit });
      }
      if (triggerType === "subscription_ended") {
        const result = await dependencies.endSubscription(triggerableId);
        if (result === "unknown") return await ignore("unknown_subscription");
        await dependencies.finishEvent({ key: eventKey, status: "done" });
        return Response.json({ status: "deactivated" });
      }
      return await ignore("unhandled_trigger");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown";
      await dependencies.finishEvent({ key: eventKey, status: "failed", detail }).catch(() => {});
      // Never log the body, email address or signature.
      console.error("Plug&Pay webhook failed", { triggerType, triggerableId, detail });
      // A 5xx makes Plug&Pay retry and flags the order in its dashboard.
      return Response.json({ error: "failed" }, { status: 500 });
    }
  };
}

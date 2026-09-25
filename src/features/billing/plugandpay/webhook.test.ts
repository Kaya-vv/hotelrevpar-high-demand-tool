import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlugAndPayOrder } from "./client";
import { createPlugAndPayWebhookHandler, type PlugAndPayWebhookDependencies } from "./webhook";

const KEY = "webhook-key";
const HOTEL_PRODUCT = 4821;

function order(overrides: Partial<PlugAndPayOrder> = {}): PlugAndPayOrder {
  return {
    id: 77,
    mode: "live",
    payment: { status: "paid" },
    items: [
      { product_id: HOTEL_PRODUCT, quantity: 2, subscription: { id: 901 } },
      { product_id: HOTEL_PRODUCT, quantity: 1, subscription: null },
    ],
    billing: { contact: { email: " Buyer@Example.com ", firstname: "Robert", lastname: "Jansen", company: "Hotel Zuid" } },
    ...overrides,
  };
}

function setup(overrides: Partial<PlugAndPayWebhookDependencies> = {}) {
  const claimed = new Set<string>();
  const dependencies = {
    webhookKey: KEY,
    hotelProductIds: [HOTEL_PRODUCT],
    allowTestMode: false,
    fetchOrder: vi.fn(async () => order()),
    claimEvent: vi.fn(async ({ key }: { key: string }) => {
      if (claimed.has(key)) return "duplicate" as const;
      claimed.add(key);
      return "claimed" as const;
    }),
    finishEvent: vi.fn(async () => {}),
    findAccountByEmail: vi.fn(async () => null),
    applyPurchase: vi.fn(async () => "account-new"),
    endSubscription: vi.fn(async () => "deactivated" as const),
    ...overrides,
  } satisfies PlugAndPayWebhookDependencies;
  return { dependencies, handler: createPlugAndPayWebhookHandler(dependencies) };
}

function request(body: unknown, signature?: string) {
  const raw = JSON.stringify(body);
  return new Request("http://localhost/api/webhooks/plugandpay", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Signature": signature ?? createHmac("sha256", KEY).update(raw).digest("hex") },
    body: raw,
  });
}

const paid = { event: { trigger_type: "order_payment_completed", triggerable_id: "77", triggerable_type: "order" }, rule_id: 1, tenant_id: 1 };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Plug&Pay webhook", () => {
  it("rejects a body whose signature does not match before touching anything", async () => {
    const { dependencies, handler } = setup();
    const signature = createHmac("sha256", "other-key").update(JSON.stringify(paid)).digest("hex");
    const response = await handler(request(paid, signature));
    expect(response.status).toBe(401);
    expect(dependencies.claimEvent).not.toHaveBeenCalled();
    expect(dependencies.applyPurchase).not.toHaveBeenCalled();
  });

  it("provisions a paid hotel order with the summed quantity and the subscription id", async () => {
    const { dependencies, handler } = setup();
    const response = await handler(request(paid));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "provisioned", hotels: 3 });
    expect(dependencies.fetchOrder).toHaveBeenCalledWith("77");
    expect(dependencies.applyPurchase).toHaveBeenCalledWith({
      accountId: null, accountName: "Hotel Zuid", email: "buyer@example.com", hotelLimit: 3, subscriptionId: "901",
    });
    expect(dependencies.finishEvent).toHaveBeenCalledWith({ key: "order_payment_completed:77", status: "done", accountId: "account-new" });
  });

  it("provisions only once when the same message arrives twice", async () => {
    const { dependencies, handler } = setup();
    await handler(request(paid));
    const second = await handler(request(paid));
    expect(await second.json()).toEqual({ status: "duplicate" });
    expect(dependencies.applyPurchase).toHaveBeenCalledTimes(1);
  });

  it("ignores an order for another product", async () => {
    const { dependencies, handler } = setup({
      fetchOrder: vi.fn(async () => order({ items: [{ product_id: 1234, quantity: 5, subscription: { id: 3 } }] })),
    });
    const response = await handler(request(paid));
    expect(response.status).toBe(200);
    expect(dependencies.applyPurchase).not.toHaveBeenCalled();
    expect(dependencies.finishEvent).toHaveBeenCalledWith({ key: "order_payment_completed:77", status: "ignored", detail: "no_hotel_product" });
  });

  it("ignores test-mode and unpaid orders", async () => {
    const test = setup({ fetchOrder: vi.fn(async () => order({ mode: "test" })) });
    await test.handler(request(paid));
    const unpaid = setup({ fetchOrder: vi.fn(async () => order({ payment: { status: "open" } })) });
    await unpaid.handler(request(paid));
    expect(test.dependencies.applyPurchase).not.toHaveBeenCalled();
    expect(unpaid.dependencies.applyPurchase).not.toHaveBeenCalled();
  });

  it("raises the limit on the buyer's existing account instead of creating another", async () => {
    const { dependencies, handler } = setup({ findAccountByEmail: vi.fn(async () => "account-existing") });
    await handler(request(paid));
    expect(dependencies.findAccountByEmail).toHaveBeenCalledWith("buyer@example.com");
    expect(dependencies.applyPurchase).toHaveBeenCalledWith(expect.objectContaining({ accountId: "account-existing", hotelLimit: 3 }));
  });

  it("deactivates a known subscription and ignores an unknown one", async () => {
    const ended = { event: { trigger_type: "subscription_ended", triggerable_id: "901" } };
    const known = setup();
    const knownResponse = await known.handler(request(ended));
    expect(knownResponse.status).toBe(200);
    expect(known.dependencies.endSubscription).toHaveBeenCalledWith("901");
    expect(known.dependencies.finishEvent).toHaveBeenCalledWith({ key: "subscription_ended:901", status: "done" });

    const unknown = setup({ endSubscription: vi.fn(async () => "unknown" as const) });
    const unknownResponse = await unknown.handler(request(ended));
    expect(unknownResponse.status).toBe(200);
    expect(await unknownResponse.json()).toEqual({ status: "ignored", detail: "unknown_subscription" });
  });

  it("records a failure and answers 500 so Plug&Pay retries", async () => {
    const { dependencies, handler } = setup({ fetchOrder: vi.fn(async () => { throw new Error("plugandpay_order_503"); }) });
    const response = await handler(request(paid));
    expect(response.status).toBe(500);
    expect(dependencies.finishEvent).toHaveBeenCalledWith({ key: "order_payment_completed:77", status: "failed", detail: "plugandpay_order_503" });
  });

  it("fails loudly on a paid order without a billing email", async () => {
    const { dependencies, handler } = setup({ fetchOrder: vi.fn(async () => order({ billing: { contact: null } })) });
    const response = await handler(request(paid));
    expect(response.status).toBe(500);
    expect(dependencies.applyPurchase).not.toHaveBeenCalled();
  });

  it("accepts the flat payload shape as well as the nested one", async () => {
    const { dependencies, handler } = setup();
    const response = await handler(request({ trigger_type: "order_payment_completed", triggerable_id: 78 }));
    expect(response.status).toBe(200);
    expect(dependencies.fetchOrder).toHaveBeenCalledWith("78");
  });

  it("refuses a body without a trigger so Plug&Pay stops retrying it", async () => {
    const { dependencies, handler } = setup();
    const response = await handler(request({ hello: "world" }));
    expect(response.status).toBe(400);
    expect(dependencies.claimEvent).not.toHaveBeenCalled();
  });
});

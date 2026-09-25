import "server-only";

import { z } from "zod";

const API_BASE = "https://api.plugandpay.com/v2";

const orderSchema = z.looseObject({
  id: z.number(),
  mode: z.enum(["test", "live"]).optional(),
  payment: z.looseObject({ status: z.string() }).nullish(),
  items: z.array(z.looseObject({
    product_id: z.number(),
    quantity: z.number(),
    subscription: z.looseObject({ id: z.number() }).nullish(),
  })).default([]),
  billing: z.looseObject({
    contact: z.looseObject({
      email: z.string().optional(),
      firstname: z.string().optional(),
      lastname: z.string().optional(),
      company: z.string().optional(),
    }).nullish(),
  }).nullish(),
});

export type PlugAndPayOrder = z.infer<typeof orderSchema>;

export async function fetchPlugAndPayOrder(id: string, token: string): Promise<PlugAndPayOrder> {
  const response = await fetch(
    `${API_BASE}/orders/${encodeURIComponent(id)}?include=items,billing,payment,subscriptions`,
    {
      headers: {
        Accept: "application/json",
        // Plug&Pay rejects calls without this exact User-Agent.
        "User-Agent": "CustomApiCall/2",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    },
  );
  if (!response.ok) throw new Error(`plugandpay_order_${response.status}`);
  const body = await response.json();
  // The API reference does not show whether the order is wrapped in `data`; accept both.
  return orderSchema.parse(body?.data ?? body);
}

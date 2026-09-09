import { expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { requestMessages } from "./claude";

it("keeps direct requests bounded while a slow source does not block the remaining queue", async () => {
  let release!: () => void;
  const slow = new Promise<void>(resolve => { release = resolve; });
  let active = 0, maximum = 0;
  const calls: number[] = [];
  const create = vi.fn(async (request: { max_tokens: number }) => {
    active++; maximum = Math.max(maximum, active); calls.push(request.max_tokens);
    try {
      if (request.max_tokens === 1) await slow;
      else await Promise.resolve();
      return { id: String(request.max_tokens) };
    } finally { active--; }
  });
  const requests = Array.from({ length: 10 }, (_, i) => ({ params: { model: "test", max_tokens: i + 1, messages: [] }, options: { timeout: 1000, maxRetries: 0 } }));
  const pending = requestMessages({ messages: { create } } as unknown as Anthropic, "verification", requests, { enabled: false });
  try {
    await vi.waitFor(() => expect(calls).toContain(10), { timeout: 100 });
    expect(maximum).toBeLessThanOrEqual(8);
  } finally { release(); await pending; }
  const results = await pending;
  expect(results.map(result => result.status === "fulfilled" && result.value.id)).toEqual(requests.map(request => String(request.params.max_tokens)));
});

import type Anthropic from "@anthropic-ai/sdk";
import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { checkEventSizes, type SizeCheckEvent } from "./size-check";

const event = (id: string): SizeCheckEvent => ({ id, title: `Event ${id}`, category: "festival", venue: "Ahoy",
  startAt: "2027-01-28T09:00:00Z", endAt: "2027-02-07T22:00:00Z" });
const answer = (verdict: string) => ({ id: `msg-${verdict}`, stop_reason: "end_turn", usage: { input_tokens: 290, output_tokens: 60 },
  content: [{ type: "text", text: JSON.stringify({ verdict, visitors: "onbekend", reason: "Reden." }) }] });

it("keeps every answer it got and leaves a failed or unreadable one for the next run", async () => {
  const create = vi.fn()
    .mockResolvedValueOnce(answer("big"))
    .mockRejectedValueOnce(new Error("overloaded"))
    .mockResolvedValueOnce(answer("enormous"));
  const onUsage = vi.fn(async () => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const result = await checkEventSizes([event("a"), event("b"), event("c")], {
    client: { messages: { create } } as unknown as Pick<Anthropic, "messages">,
    now: new Date("2026-09-29T09:00:00Z"), onUsage,
  });
  expect([...result.checks.keys()]).toEqual(["a"]);
  expect(result.checks.get("a")).toMatchObject({ version: 1, verdict: "big", checkedAt: "2026-09-29T09:00:00.000Z" });
  expect(result.failed).toBe(2);
  // The unreadable answer was still paid for, so it still counts towards the run's cost.
  expect(onUsage).toHaveBeenCalledTimes(2);
  expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ phase: "size_check", inputTokens: 290 }));
});

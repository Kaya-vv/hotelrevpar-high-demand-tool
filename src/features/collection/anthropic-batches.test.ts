import type Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import { describe, expect, it, vi } from "vitest";

import {
  claudeMarketCacheKey,
  claudeMarketGroupKey,
  runAnthropicBatch,
  type BatchStore,
  type ClaudeMarketInput,
} from "./anthropic-batches";

const message = (text: string) => ({
  content: [{ type: "text", text }],
  usage: { input_tokens: 1, output_tokens: 1 },
}) as unknown as Anthropic.Message;

describe("Anthropic batch cache", () => {
  it("shares a market across accounts without mixing different scopes", () => {
    const input: ClaudeMarketInput = {
      start: "2026-09-04",
      end: "2026-12-03",
      location: "Rotterdam",
      radiusKm: 25,
      model: "claude-sonnet-5",
      discoveryModel: "claude-sonnet-5",
      knownUrls: ["https://example.com/robert"],
    };

    expect(claudeMarketCacheKey({ ...input, location: " rotterdam ", knownUrls: [] }))
      .toBe(claudeMarketCacheKey(input));
    expect(claudeMarketCacheKey({ ...input, radiusKm: 30 }))
      .not.toBe(claudeMarketCacheKey(input));
    expect(claudeMarketCacheKey({ ...input, discoveryMode: "long_range" }))
      .not.toBe(claudeMarketCacheKey(input));
    // The radius leaves the identity so a lookup can compare it as a column: a 25 km hotel may
    // read a 50 km search of the same city, but never a search of a different city or horizon.
    expect(claudeMarketGroupKey({ ...input, location: " rotterdam " }))
      .toBe(claudeMarketGroupKey(input));
    expect(claudeMarketGroupKey({ ...input, radiusKm: 50 } as ClaudeMarketInput))
      .toBe(claudeMarketGroupKey(input));
    expect(claudeMarketGroupKey({ ...input, location: "Eindhoven" }))
      .not.toBe(claudeMarketGroupKey(input));
    expect(claudeMarketGroupKey({ ...input, discoveryMode: "long_range" }))
      .not.toBe(claudeMarketGroupKey(input));
  });

  it("submits once, restores request order, and charges usage once", async () => {
    let row: Awaited<ReturnType<BatchStore["get"]>> = null;
    let usageReported = false;
    const store: BatchStore = {
      removeExpired: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(async () => row),
      claim: vi.fn(async (_key, _owner, expiresAt) => {
        row = { batch_id: null, created_at: new Date().toISOString(), error: null, results: null, status: "creating" };
        expect(expiresAt).toBeTruthy();
        return true;
      }),
      attach: vi.fn(async (_key, _owner, batchId) => {
        row = { ...row!, batch_id: batchId, status: "processing" };
      }),
      complete: vi.fn(async (_key, results) => {
        row = { ...row!, results, status: "completed" };
      }),
      fail: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
      discard: vi.fn(async () => { row = null; }),
      claimUsage: vi.fn(async () => {
        if (usageReported) return false;
        usageReported = true;
        return true;
      }),
    };
    const create = vi.fn().mockResolvedValue({ id: "batch-1" });
    const client = {
      messages: {
        batches: {
          create,
          retrieve: vi.fn().mockResolvedValue({ processing_status: "ended" }),
          results: vi.fn(async function* () {
            yield { custom_id: "request-1", result: { type: "succeeded", message: message("second") } };
            yield { custom_id: "request-0", result: { type: "succeeded", message: message("first") } };
          }),
        },
      },
    } as unknown as Anthropic;
    const requests = ["first", "second"].map((text) => ({
      model: "claude-sonnet-5",
      max_tokens: 10,
      messages: [{ role: "user", content: text }],
    })) satisfies MessageCreateParamsNonStreaming[];

    const first = await runAnthropicBatch(client, requests, { store, wait: async () => undefined });
    const cached = await runAnthropicBatch(client, requests, { store, wait: async () => undefined });

    expect(create).toHaveBeenCalledOnce();
    expect(first.map((result) => result.status === "fulfilled" && result.value.message.content[0])).toMatchObject([
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ]);
    expect(first.map((result) => result.status === "fulfilled" && result.value.billable)).toEqual([true, true]);
    expect(cached.map((result) => result.status === "fulfilled" && result.value.billable)).toEqual([false, false]);
    expect(store.complete).toHaveBeenCalledOnce();
  });

  it("resubmits instead of replaying a batch in which nothing succeeded", async () => {
    let row: Awaited<ReturnType<BatchStore["get"]>> = null;
    const store: BatchStore = {
      removeExpired: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(async () => row),
      claim: vi.fn(async () => {
        row = { batch_id: null, created_at: new Date().toISOString(), error: null, results: null, status: "creating" };
        return true;
      }),
      attach: vi.fn(async (_key, _owner, batchId) => { row = { ...row!, batch_id: batchId, status: "processing" }; }),
      complete: vi.fn(async (_key, results) => { row = { ...row!, results, status: "completed" }; }),
      fail: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
      discard: vi.fn(async () => { row = null; }),
      claimUsage: vi.fn().mockResolvedValue(false),
    };
    const create = vi.fn(async () => ({ id: `batch-${create.mock.calls.length}` }));
    const client = {
      messages: {
        batches: {
          create,
          retrieve: vi.fn().mockResolvedValue({ processing_status: "ended" }),
          results: vi.fn(async function* () {
            yield { custom_id: "request-0", result: { type: "canceled" } };
          }),
        },
      },
    } as unknown as Anthropic;
    const requests = [{
      model: "claude-sonnet-5",
      max_tokens: 10,
      messages: [{ role: "user", content: "only" }],
    }] satisfies MessageCreateParamsNonStreaming[];

    const first = await runAnthropicBatch(client, requests, { store, wait: async () => undefined });

    // The rejection still reaches the caller so it can drop the lead and release its reservation.
    expect(first).toHaveLength(1);
    expect(first[0].status).toBe("rejected");
    expect(store.discard).toHaveBeenCalledOnce();
    expect(store.complete).not.toHaveBeenCalled();

    // A cancellation is transient: the same request set must submit again, not replay for 30 days.
    await runAnthropicBatch(client, requests, { store, wait: async () => undefined });
    expect(create).toHaveBeenCalledTimes(2);
  });
});

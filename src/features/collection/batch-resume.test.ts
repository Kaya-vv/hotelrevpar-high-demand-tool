import type Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import { expect, it, vi } from "vitest";
import { BatchPendingError, runAnthropicBatch, type BatchRow, type BatchStore } from "./anthropic-batches";
import { batchCacheKey, legacyBatchCacheKeys } from "./batch-identity";

const original = [{ model: "claude-sonnet-5", max_tokens: 100, messages: [{ role: "user", content: [
  { type: "text", text: "Confirm the official date", cache_control: { type: "ephemeral" } },
] }] }] satisfies MessageCreateParamsNonStreaming[];
// PostgreSQL JSONB preserves arrays but sorts object fields; this is the saved shape.
const restored = [{ model: "claude-sonnet-5", messages: [{ role: "user", content: [
  { text: "Confirm the official date", type: "text", cache_control: { type: "ephemeral" } },
] }], max_tokens: 100 }] satisfies MessageCreateParamsNonStreaming[];

function fixture() {
  const rows = new Map<string, BatchRow>();
  const reported = new Set<string>();
  const result = [{ custom_id: "request-0", result: { type: "succeeded", message: {
    id: "paid-message", content: [{ type: "text", text: "confirmed" }], usage: { input_tokens: 10, output_tokens: 5 },
  } } }];
  const store: BatchStore = {
    removeExpired: async () => {}, get: async key => rows.get(key) ?? null,
    claim: async key => {
      if (rows.has(key)) return false;
      rows.set(key, { batch_id: null, status: "creating", results: null, error: null, created_at: new Date().toISOString() });
      return true;
    },
    attach: async (key, _owner, batch_id) => { Object.assign(rows.get(key)!, { batch_id, status: "processing" }); },
    complete: async (key, results) => { Object.assign(rows.get(key)!, { results, status: "completed" }); },
    fail: async (key, error) => { Object.assign(rows.get(key)!, { error, status: "failed" }); },
    release: async key => { rows.delete(key); }, discard: async key => { rows.delete(key); },
    claimUsage: async key => { if (reported.has(key)) return false; reported.add(key); return true; },
  };
  const create = vi.fn(async () => ({ id: `batch-${create.mock.calls.length}` }));
  const retrieve = vi.fn(async () => ({ processing_status: "in_progress" }));
  const client = { messages: { batches: { create, retrieve, results: async function* () { yield* result; } } } } as unknown as Anthropic;
  return { rows, store, create, retrieve, client, result };
}

it("resumes after a database round trip without a second submission and reports usage once", async () => {
  expect(restored).toEqual(original);
  expect(JSON.stringify(restored)).not.toEqual(JSON.stringify(original));
  const f = fixture();
  await expect(runAnthropicBatch(f.client, original, { store: f.store, wait: async () => { throw new BatchPendingError(); } })).rejects.toBeInstanceOf(BatchPendingError);
  f.retrieve.mockResolvedValue({ processing_status: "ended" });
  const resumed = await runAnthropicBatch(f.client, restored, { store: f.store });
  const replay = await runAnthropicBatch(f.client, original, { store: f.store });
  expect(f.create).toHaveBeenCalledOnce();
  expect(f.retrieve).toHaveBeenLastCalledWith("batch-1");
  expect(resumed[0]).toMatchObject({ status: "fulfilled", value: { billable: true } });
  expect(replay[0]).toMatchObject({ status: "fulfilled", value: { billable: false } });
});

it("keeps array order and changed request values significant", () => {
  expect(batchCacheKey(original)).toBe(batchCacheKey(restored));
  const changed = [{ ...original[0], max_tokens: 200 }];
  expect(batchCacheKey(changed)).not.toBe(batchCacheKey(original));
  expect(batchCacheKey([...original, ...changed])).not.toBe(batchCacheKey([...changed, ...original]));
});

it.each(["processing", "completed"])("recovers an existing legacy %s batch without buying it again", async status => {
  const f = fixture();
  const key = legacyBatchCacheKeys(restored)[0];
  f.rows.set(key, { batch_id: "already-paid", status, results: status === "completed" ? f.result : null, error: null, created_at: new Date().toISOString() });
  f.retrieve.mockResolvedValue({ processing_status: "ended" });
  await runAnthropicBatch(f.client, original, { store: f.store, allowCreate: false });
  expect(f.create).not.toHaveBeenCalled();
  expect(f.rows.get(key)?.status).toBe("completed");
});

it("prefers the completed legacy copy when the original copy was orphaned", async () => {
  const f = fixture();
  const [first, second] = legacyBatchCacheKeys(original);
  expect(first).not.toBe(second);
  f.rows.set(first, { batch_id: "orphan", status: "processing", results: null, error: null, created_at: new Date().toISOString() });
  f.rows.set(second, { batch_id: "recorded", status: "completed", results: f.result, error: null, created_at: new Date().toISOString() });
  await runAnthropicBatch(f.client, original, { store: f.store });
  expect(f.create).not.toHaveBeenCalled();
  expect(f.retrieve).not.toHaveBeenCalled();
});

it("does not submit unmatched work from an old saved research cycle", async () => {
  const f = fixture();
  await expect(runAnthropicBatch(f.client, restored, { store: f.store, allowCreate: false })).rejects.toThrow("needs reconciliation");
  expect(f.create).not.toHaveBeenCalled();
  expect(f.rows.size).toBe(0);
});

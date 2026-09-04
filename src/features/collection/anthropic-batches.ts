import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import { createHash, randomUUID } from "node:crypto";

import type { Json } from "@/lib/supabase/database.types";

import type { SourceResult } from "./types";

export type BatchedMessage = {
  message: Anthropic.Message;
  billable: boolean;
};

export type BatchedMessageResult =
  | { status: "fulfilled"; value: BatchedMessage }
  | { status: "rejected"; reason: unknown };

export type BatchRow = {
  batch_id: string | null;
  created_at: string;
  error: string | null;
  results: Json | null;
  status: string;
};

export type BatchStore = {
  removeExpired: (cacheKey: string, now: string) => Promise<void>;
  get: (cacheKey: string) => Promise<BatchRow | null>;
  claim: (cacheKey: string, ownerToken: string, expiresAt: string) => Promise<boolean>;
  attach: (cacheKey: string, ownerToken: string, batchId: string, expiresAt: string) => Promise<void>;
  complete: (cacheKey: string, results: Json) => Promise<void>;
  fail: (cacheKey: string, error: string) => Promise<void>;
  release: (cacheKey: string, ownerToken: string) => Promise<void>;
  claimUsage: (cacheKey: string) => Promise<boolean>;
};

async function adminClient() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return createAdminClient();
}

function batchStore(): BatchStore {
  return {
    async removeExpired(_cacheKey, now) {
      const admin = await adminClient();
      const { error } = await admin
        .from("anthropic_batch_cache")
        .delete()
        .lt("expires_at", now);
      if (error) throw error;
    },
    async get(cacheKey) {
      const admin = await adminClient();
      const { data, error } = await admin
        .from("anthropic_batch_cache")
        .select("batch_id, created_at, error, results, status")
        .eq("cache_key", cacheKey)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async claim(cacheKey, ownerToken, expiresAt) {
      const admin = await adminClient();
      const { error } = await admin.from("anthropic_batch_cache").insert({
        cache_key: cacheKey,
        owner_token: ownerToken,
        status: "creating",
        expires_at: expiresAt,
      });
      if (error?.code === "23505") return false;
      if (error) throw error;
      return true;
    },
    async attach(cacheKey, ownerToken, batchId, expiresAt) {
      const admin = await adminClient();
      const { error } = await admin
        .from("anthropic_batch_cache")
        .update({
          batch_id: batchId,
          status: "processing",
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("cache_key", cacheKey)
        .eq("owner_token", ownerToken);
      if (error) throw error;
    },
    async complete(cacheKey, results) {
      const admin = await adminClient();
      const { error } = await admin
        .from("anthropic_batch_cache")
        .update({
          results,
          status: "completed",
          updated_at: new Date().toISOString(),
        })
        .eq("cache_key", cacheKey);
      if (error) throw error;
    },
    async fail(cacheKey, errorMessage) {
      const admin = await adminClient();
      const { error } = await admin
        .from("anthropic_batch_cache")
        .update({
          error: errorMessage,
          status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("cache_key", cacheKey);
      if (error) throw error;
    },
    async release(cacheKey, ownerToken) {
      const admin = await adminClient();
      const { error } = await admin
        .from("anthropic_batch_cache")
        .delete()
        .eq("cache_key", cacheKey)
        .eq("owner_token", ownerToken);
      if (error) throw error;
    },
    async claimUsage(cacheKey) {
      const admin = await adminClient();
      const { data, error } = await admin
        .from("anthropic_batch_cache")
        .update({ usage_reported: true })
        .eq("cache_key", cacheKey)
        .eq("usage_reported", false)
        .select("cache_key")
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
  };
}

function cacheKey(requests: MessageCreateParamsNonStreaming[]) {
  return createHash("sha256")
    .update(JSON.stringify({ version: 1, requests }))
    .digest("hex");
}

export type ClaudeMarketInput = {
  start: string;
  end: string;
  location: string;
  radiusKm: number;
  model: string;
  discoveryModel: string;
  knownUrls: string[];
};

export function claudeMarketCacheKey(input: ClaudeMarketInput) {
  // Account history may improve the first run, but it must not partition the shared city result.
  return createHash("sha256")
    .update(JSON.stringify({
      version: 2,
      start: input.start,
      end: input.end,
      location: input.location.trim().toLocaleLowerCase("nl-NL"),
      radiusKm: input.radiusKm,
      model: input.model,
      discoveryModel: input.discoveryModel,
    }))
    .digest("hex");
}

export async function loadClaudeMarketResult(input: ClaudeMarketInput) {
  const admin = await adminClient();
  const key = claudeMarketCacheKey(input);
  const now = new Date().toISOString();
  const { error: deleteError } = await admin
    .from("claude_market_cache")
    .delete()
    .lt("expires_at", now);
  if (deleteError) throw deleteError;
  const { data, error } = await admin
    .from("claude_market_cache")
    .select("result")
    .eq("cache_key", key)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const result = data.result as unknown as SourceResult;
  return { ...result, requests: 0, usage: {} };
}

export async function saveClaudeMarketResult(
  input: ClaudeMarketInput,
  result: SourceResult,
) {
  const admin = await adminClient();
  const { error } = await admin.from("claude_market_cache").upsert({
    cache_key: claudeMarketCacheKey(input),
    search_location: input.location.trim(),
    radius_km: input.radiusKm,
    window_start: input.start,
    window_end: input.end,
    model: input.model,
    discovery_model: input.discoveryModel,
    result: result as unknown as Json,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (error) throw error;
}

function decodeResults(value: Json, billable: boolean): BatchedMessageResult[] {
  if (!Array.isArray(value)) throw new Error("Anthropic batchresultaat is ongeldig.");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { status: "rejected", reason: new Error("Anthropic batchresultaat is ongeldig.") };
    }
    const result = entry.result;
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      return { status: "rejected", reason: new Error("Anthropic batchresultaat ontbreekt.") };
    }
    if (result.type === "succeeded" && result.message) {
      return {
        status: "fulfilled",
        value: { message: result.message as unknown as Anthropic.Message, billable },
      };
    }
    const detail = result.type === "errored" ? JSON.stringify(result.error) : String(result.type);
    return { status: "rejected", reason: new Error(`Anthropic batchverzoek mislukt: ${detail}`) };
  });
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function runAnthropicBatch(
  client: Anthropic,
  requests: MessageCreateParamsNonStreaming[],
  options: {
    store?: BatchStore;
    wait?: (milliseconds: number) => Promise<void>;
    pollMilliseconds?: number;
  } = {},
): Promise<BatchedMessageResult[]> {
  if (!requests.length) return [];
  const store = options.store ?? batchStore();
  const pause = options.wait ?? wait;
  const pollMilliseconds = options.pollMilliseconds ?? 5_000;
  const key = cacheKey(requests);
  const now = new Date();
  await store.removeExpired(key, now.toISOString());
  let row = await store.get(key);

  if (!row) {
    const ownerToken = randomUUID();
    // The lease must outlive the stuck-creation check below. With both at five minutes the
    // expiry sweep deletes the row first, `attach` silently updates nothing, and the batch that
    // Anthropic already accepted is orphaned while the next attempt submits — and pays for — a
    // duplicate. A longer lease makes the stuck check the failure path instead.
    const claimExpiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    if (await store.claim(key, ownerToken, claimExpiresAt)) {
      try {
        const batch = await client.messages.batches.create({
          requests: requests.map((params, index) => ({
            custom_id: `request-${index}`,
            params,
          })),
        });
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        await store.attach(key, ownerToken, batch.id, expiresAt);
      } catch (error) {
        await store.release(key, ownerToken);
        throw error;
      }
    }
    row = await store.get(key);
  }

  while (row) {
    if (row.status === "completed" && row.results) {
      return decodeResults(row.results, await store.claimUsage(key));
    }
    if (row.status === "failed") {
      throw new Error(row.error ?? "Anthropic batchverwerking is mislukt.");
    }
    if (!row.batch_id) {
      if (Date.now() - new Date(row.created_at).getTime() > 5 * 60 * 1000) {
        throw new Error("Anthropic batchaanmaak bleef hangen.");
      }
      await pause(pollMilliseconds);
      row = await store.get(key);
      continue;
    }

    const batch = await client.messages.batches.retrieve(row.batch_id);
    if (batch.processing_status !== "ended") {
      await pause(pollMilliseconds);
      row = await store.get(key);
      continue;
    }

    const decoder = await client.messages.batches.results(row.batch_id);
    const results: unknown[] = [];
    for await (const result of decoder) results.push(result);
    results.sort((left, right) => {
      const index = (value: unknown) => Number(String((value as { custom_id?: string }).custom_id).split("-")[1]);
      return index(left) - index(right);
    });
    if (results.length !== requests.length) {
      const error = `Anthropic batch gaf ${results.length} van ${requests.length} resultaten terug.`;
      await store.fail(key, error);
      throw new Error(error);
    }
    await store.complete(key, results as Json);
    row = await store.get(key);
  }

  throw new Error("Anthropic batchcache ontbreekt.");
}

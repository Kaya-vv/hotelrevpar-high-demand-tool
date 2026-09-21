import { createHash } from "node:crypto";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";

function orderedJson(value: unknown, compare: (left: string, right: string) => number) {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort(compare).map(key => [key, item[key]]))
    : item);
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** JSONB reorders object fields. Array order and every request value remain significant. */
export function batchCacheKey(requests: MessageCreateParamsNonStreaming[]) {
  return hash(orderedJson({ version: 2, requests }, (left, right) => left < right ? -1 : left > right ? 1 : 0));
}

/** Read existing paid batches during rollout, including requests restored from JSONB. */
export function legacyBatchCacheKeys(requests: MessageCreateParamsNonStreaming[]) {
  const restored = JSON.parse(orderedJson(requests, (left, right) =>
    Buffer.byteLength(left) - Buffer.byteLength(right) || Buffer.compare(Buffer.from(left), Buffer.from(right))));
  return [...new Set([requests, restored].map(value => hash(JSON.stringify({ version: 1, requests: value }))))];
}

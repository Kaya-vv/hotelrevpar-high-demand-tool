import { createHash } from "node:crypto";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import type { ClaudeUsageEvent } from "./sources/claude";
import type { LongRangeState } from "./long-range-store";

export function modelRates(model: string): [number, number] | null {
  if (model.startsWith("claude-sonnet-5")) return [2, 10];
  if (model.startsWith("claude-haiku-4-5")) return [1, 5];
  if (model.startsWith("claude-sonnet-4")) return [3, 15];
  return null;
}

export function estimatedCostUsd(event: ClaudeUsageEvent, batch: boolean) {
  const rates = modelRates(event.model);
  if (!rates) return null;
  return ((event.inputTokens + (event.cacheWriteTokens ?? 0) * 1.25 + (event.cacheReadTokens ?? 0) * 0.1) * rates[0]
    + event.outputTokens * rates[1]) / 1_000_000 * (batch ? 0.5 : 1) + event.webSearchRequests * 0.01;
}

// Budget accounting deliberately uses a conservative 1 EUR per USD estimate. Raw USD usage is
// retained for billing reconciliation; this is not a claim about the invoiced exchange rate.
// Measured steady state is ~4 EUR per market per month, so 8 only binds while a backlog drains.
export function researchBudget(state: LongRangeState, now: Date, ceilingEur = 8) {
  const month = now.toISOString().slice(0, 7);
  if (!state.budget || state.budget.month !== month) {
    // Anthropic batches expire within 24h, so a reservation made in a previous month cannot
    // correspond to live in-flight work; carrying it would only shrink this month's ceiling.
    state.budget = { month, spentEur: 0, reservations: {}, billedIds: state.budget?.billedIds ?? [] };
  }
  const ledger = state.budget;
  return {
    reserve(params: MessageCreateParamsNonStreaming, batch: boolean) {
      const rates = modelRates(params.model);
      if (!rates) return null;
      const key = createHash("sha256").update(JSON.stringify(params)).digest("hex");
      // Never resend an unresolved request merely because a worker was retried.
      if (ledger.reservations[key] !== undefined) return batch ? key : null;
      const toolUses = (params.tools ?? []).reduce((sum, tool) => sum + ("max_uses" in tool ? Number(tool.max_uses ?? 1) : 0), 0);
      // Reserve the content bound each tool actually declares. A flat 32k per use assumed five
      // times the `max_content_tokens: 6_000` every fetch request sets, so the ceiling filled
      // from reservations while barely any money had been spent: the Eindhoven cycle deferred a
      // third of its leads, the benchmark among them, at 0.12 EUR of an 8 EUR ledger.
      const contentBound = (params.tools ?? []).reduce((sum, tool) => sum + ("max_uses" in tool
        ? Number(tool.max_uses ?? 1) * ("max_content_tokens" in tool ? Number(tool.max_content_tokens ?? 32_000) : 32_000)
        : 0), 0);
      const inputBound = Buffer.byteLength(JSON.stringify(params)) + 10_000 + contentBound;
      const reserved = (inputBound * rates[0] * 1.25 + params.max_tokens * rates[1]) / 1_000_000 * (batch ? 0.5 : 1) + toolUses * 0.01;
      const outstanding = Object.values(ledger.reservations).reduce((sum, value) => sum + value, 0);
      if (ledger.spentEur + outstanding + reserved > ceilingEur) return null;
      ledger.reservations[key] = reserved;
      return key;
    },
    releaseUnbilled(key: string) { delete ledger.reservations[key]; },
    settle(key: string, event: ClaudeUsageEvent, batch: boolean) {
      const cost = estimatedCostUsd(event, batch);
      if (cost === null) return;
      if (!event.requestId || !ledger.billedIds.includes(event.requestId)) {
        ledger.spentEur += cost;
        if (event.requestId) ledger.billedIds.push(event.requestId);
      }
      delete ledger.reservations[key];
    },
  };
}

import Anthropic from "@anthropic-ai/sdk";
import { createLunaClient, LUNA_FAST_MODEL, LUNA_MODEL, type ResearchClient } from "./luna-client";

const DEFAULT_TRIAGE_MODEL = "claude-haiku-4-5-20251001";

// Luna is the research model since the 23 September 2026 comparison. RESEARCH_PROVIDER=sonnet
// is the rollback for 30 days after the switch; then the Sonnet branch is deleted.
export type ResearchProvider = "luna" | "sonnet";

export function researchProvider(): ResearchProvider {
  return process.env.RESEARCH_PROVIDER?.trim() === "sonnet" ? "sonnet" : "luna";
}

let luna: ResearchClient | undefined;

export function researchClient(): ResearchClient {
  if (researchProvider() === "sonnet") return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  // One client per process, so its concurrency gate covers every request this process sends.
  luna ??= createLunaClient();
  return luna;
}

/** `discovery` is set only when it differs from the main model; callers fall back to their main model. */
export function researchModels(): { primary: string; discovery?: string; triage: string } {
  if (researchProvider() === "luna") return { primary: LUNA_MODEL, triage: LUNA_FAST_MODEL };
  // `||`, not `??`: Vercel hands an env var that exists but is blank through as "", and the
  // batch API rejects `model: ""` for every request in the phase.
  return {
    primary: process.env.ANTHROPIC_MODEL?.trim() ?? "",
    discovery: process.env.ANTHROPIC_DISCOVERY_MODEL?.trim() || undefined,
    triage: process.env.ANTHROPIC_TRIAGE_MODEL?.trim() || DEFAULT_TRIAGE_MODEL,
  };
}

// OpenAI's Batch API rejects web search, and search fees are most of Luna's bill, so Luna never
// batches.
export function researchBatchingEnabled(): boolean {
  return researchProvider() === "sonnet" && process.env.ANTHROPIC_BATCHES !== "disabled";
}

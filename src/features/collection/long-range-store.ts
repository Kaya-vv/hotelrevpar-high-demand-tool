import { createHash, randomUUID } from "node:crypto";
import type { EventCandidate } from "@/features/events/types";
import type { Json } from "@/lib/supabase/database.types";

import type { MessageRequest } from "./sources/claude";
import type { OfficialPage } from "./official-pages";

export type ResearchJob = { leadKey: string; windowStart?: string; kind: "fetch" | "deep" | "resolve" | "evidence"; target?: string; providerFallback?: boolean; checkedAt?: string; pages?: OfficialPage[]; cached?: boolean; chunks?: { url: string; hash: string; index: number; total: number }[] };
export type ResearchCycle = {
  monitoringVersion?: number;
  startedAt: string; waves: number; leadKeys: string[]; finished?: boolean;
  retrieved?: Record<string, string[]>;
  queued: ResearchJob[];
  pending?: { phase: "search" | "verification"; requests: MessageRequest[]; indices: number[]; reservations: string[]; total: number; jobs?: ResearchJob[]; preparationErrors?: Record<number, string> };
};

export const LONG_RANGE_VERSION = 2;
/** Editions this account already confirmed, used to seed leads without paying for a search. */
export type LongRangeSeed = { title: string; url: string; officialPages?: string[]; lastEditionStart?: string; lastEditionEnd: string; historicalDemandPoints?: number; previousLocation?: { venue: string | null; text: string; sourceUrl: string; checkedAt: string; evidence?: EventCandidate["evidence"] } };
export type SeriesEdition = { start: string; end: string; sourceUrl: string };
export type ProjectedEdition = {
  status: "projected";
  year: number;
  start: string;
  end: string;
  confidence: "low";
  method: "annual-calendar-estimate";
  basedOn: SeriesEdition;
};
export type Lead = {
  repair?: { version: number; dueAt: string; attemptedAt?: string };
  knownEdition?: LongRangeSeed;
  officialPages?: string[];
  pendingStage?: "url" | "retrieval" | "extraction" | "location" | "demand" | "conflict";
  firstSeenAt?: string;
  discoveryGroups?: number[];
  pageCache?: Record<string, { text?: string; links?: { url: string; label: string }[]; hash: string; version: number; cursor: number; complete: boolean; chunks: number; checkedAt: string }>;
  key: string;
  title: string;
  url: string | null;
  /** Last page that actually confirmed this series; retained even if a later fetch fails. */
  officialPage?: string;
  /** Explicitly rejected fetch target; preserve the official page as evidence, not a retry target. */
  blockedPage?: string;
  lastKnownEdition?: SeriesEdition;
  /** Internal research targets only. Never returned as EventCandidates. */
  projections?: ProjectedEdition[];
  kind: "event" | "calendar";
  group: number;
  /** Set only for leads seeded from an edition this account owns; they outrank discovery leads. */
  origin?: "portfolio";
  /** Public historical assessment, used for research priority only, never future demand scoring. */
  historicalDemandPoints?: number;
  /** End date of the most recent known edition. Drives the anniversary check window. */
  anchor?: string;
  attempts?: number;
  nextCheck: string;
  checkedAt: string | null;
  outcome: "pending" | "confirmed" | "unannounced" | "failed" | "conflict";
  editions: EventCandidate[];
  notes: string[];
};
export type LongRangeState = { research?: { requestedAt: string; completedAt?: string; usage?: Record<string, number>; error?: string }; publishedAt?: string; cycle?: ResearchCycle; publicationPending?: boolean; locations?: Record<string, { latitude: number; longitude: number }>;  retrievalFailures?: Record<string, { checkedAt: string; message: string }>; pageCache?: Lead["pageCache"]; searchCycle?: { dueAt: string; broad: boolean; tasks?: { group: number; query: string; focus: string }[]; completed: string[] }; version: number; storageVersion?: number; announcementSearchAt?: string; discoveredAt: string | null; discoveryAttemptAt?: string; lastPassAt?: string; lastSweepAt?: string; leads: Lead[];
  budget?: { month: string; spentEur: number; reservations: Record<string, number>; billedIds: string[] };
};
export type LongRangeStore = {
  acquire: (key: string) => Promise<boolean>;
  release: (key: string) => Promise<void>;
  load: (key: string) => Promise<LongRangeState | null>;
  save: (key: string, state: LongRangeState) => Promise<void>;
};

// A busy or expired market lease must retry through the queue, not finish as a partial run.
export class LongRangeLeaseError extends Error {
  constructor() { super("Long-range market is busy or its lease expired; retry this collection job."); }
}

export function longRangeMarketKey(location: string, radiusKm: number) {
  return createHash("sha256").update(JSON.stringify([location.trim().toLocaleLowerCase("nl-NL"), radiusKm])).digest("hex");
}

export function createLongRangeStore(): LongRangeStore {
  const owner = randomUUID();
  return {
    async acquire(key) {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const { data, error } = await createAdminClient().rpc("claim_long_range_market", { target: key, owner });
      if (error) throw error;
      return data;
    },
    async release(key) {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const { error } = await createAdminClient().rpc("release_long_range_market", { target: key, owner });
      if (error) throw error;
    },
    async load(key) {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const { data, error } = await createAdminClient().from("long_range_markets").select("state").eq("market_key", key).maybeSingle();
      if (error) throw error;
      return data ? data.state as unknown as LongRangeState : null;
    },
    async save(key, state) {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const { data, error } = await createAdminClient().rpc("save_long_range_market", { target: key, owner, value: state as unknown as Json });
      if (error) throw error;
      if (!data) throw new LongRangeLeaseError();
    },
  };
}

import { createHash, randomUUID } from "node:crypto";
import type { EventCandidate } from "@/features/events/types";
import type { Json } from "@/lib/supabase/database.types";

export const LONG_RANGE_VERSION = 2;
/** Editions this account already confirmed, used to seed leads without paying for a search. */
export type LongRangeSeed = { title: string; url: string; lastEditionStart?: string; lastEditionEnd: string; historicalDemandPoints?: number };
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
export type LongRangeState = { version: number; discoveredAt: string | null; discoveryAttemptAt?: string; lastPassAt?: string; lastSweepAt?: string; leads: Lead[] };
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

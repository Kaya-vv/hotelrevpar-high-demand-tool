import { eventLocalDate, validEventRange } from "../events/normalize";
import { uniqueEvidenceEditions } from "../events/evidence";
import { createLongRangeStore, longRangeMarketKey, LongRangeLeaseError, type LongRangeState } from "./long-range-store";
import { collectionWindow, publishLongRangeResult, type CollectionContext } from "./run";
import { longRangeWindow } from "./sources/claude";
import { collectLongRange } from "./sources/long-range";
import type { SourceResult } from "./types";

export type MarketWork = {
  kind: "market-research" | "market-publication";
  accountId: string;
  areaId: string;
  runId: string;
  requestedAt: string;
};

export function storedLongRangeResult(state: LongRangeState | null, now = new Date()): SourceResult {
  const horizon = longRangeWindow(collectionWindow(now));
  const leads = state?.leads ?? [];
  return {
    source: "claude", requests: 0, usage: { invalidDateEditions: leads.flatMap((lead) => lead.editions).filter((event) => !validEventRange(event)).length },
    candidates: uniqueEvidenceEditions(leads.filter((lead) => lead.outcome !== "conflict").flatMap((lead) => lead.editions)
      .filter((event) => validEventRange(event) && eventLocalDate(event.endAt) >= now.toISOString().slice(0, 10) && eventLocalDate(event.startAt) <= horizon.end)),
    quarantinedProviderEventIds: leads.flatMap((lead) => lead.editions.filter((event) => lead.outcome === "conflict" || !validEventRange(event)).map((event) => event.providerEventId)),
  };
}

/** The hotel waits for a durable enqueue, never for a provider batch. */
export async function readAndEnqueueResearch(context: CollectionContext, runId: string): Promise<SourceResult> {
  const { publishCollectionJob } = await import("./jobs");
  const state = await createLongRangeStore().load(longRangeMarketKey(context.area.searchLocation, context.area.radiusKm));
  await publishCollectionJob({ kind: "market-research", accountId: context.area.accountId, areaId: context.area.id, runId, requestedAt: new Date().toISOString() });
  return { ...storedLongRangeResult(state), researchPending: true };
}

export async function processMarketWork(work: MarketWork) {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { createCollectionRepository } = await import("./repository");
  const admin = createAdminClient();
  const repository = createCollectionRepository();
  const { data: account, error } = await admin.from("accounts").select("id").eq("id", work.accountId).eq("active", true).maybeSingle();
  if (error) throw error;
  if (!account) return;
  const context = await repository.loadContext(work.accountId, work.areaId);
  if (!context.area.enabledSources.includes("claude")) return;
  const key = longRangeMarketKey(context.area.searchLocation, context.area.radiusKm);
  if (work.kind === "market-research") {
    await collectLongRange({
      ...longRangeWindow(collectionWindow()), location: context.area.searchLocation, radiusKm: context.area.radiusKm,
      seeds: context.longRangeSeeds, batching: { enabled: process.env.ANTHROPIC_BATCHES !== "disabled" },
      requestedAt: work.requestedAt,
      onUsage: (usage) => repository.recordUsage(work.runId, "claude", usage),
    });
    const { publishCollectionJob } = await import("./jobs");
    await publishCollectionJob({ ...work, kind: "market-publication" });
    return;
  }
  // Publication has its own retry and never calls an AI collector. The market lease prevents
  // clearing the publication marker while another worker is saving newer editions.
  const store = createLongRangeStore();
  if (!await store.acquire(key)) throw new LongRangeLeaseError();
  try {
    const state = await store.load(key);
    if (!state?.publicationPending) return;
    const { data: areas, error: areaError } = await admin.from("collection_areas").select("id, account_id, search_location, radius_km, accounts!inner(active)").eq("accounts.active", true).contains("enabled_sources", ["claude"]);
    if (areaError) throw areaError;
    const matching = areas.filter((area) => longRangeMarketKey(area.search_location, area.radius_km) === key);
    if (matching.length) {
      const { data: refreshing, error } = await admin.from("collection_runs").select("id").in("collection_area_id", matching.map((area) => area.id)).is("finished_at", null).limit(1);
      if (error) throw error;
      if (refreshing.length) throw new Error("Publication waits for the active hotel refresh to finish before applying newer evidence");
    }
    const result = storedLongRangeResult(state);
    const publication: Record<string, number> = {};
    for (const area of matching) {
      const counts = await publishLongRangeResult(repository, await repository.loadContext(area.account_id, area.id), result);
      for (const [name, count] of Object.entries(counts ?? {})) publication[name] = (publication[name] ?? 0) + count;
    }
    if (state.research) state.research.usage = { ...state.research.usage, ...result.usage, ...publication };
    state.publicationPending = false;
    state.publishedAt = new Date().toISOString();
    await store.save(key, state);
  } finally {
    await store.release(key);
  }
}

import { eventLocalDate, validEventRange } from "../events/normalize";
import { uniqueEvidenceEditions } from "../events/evidence";
import { createLongRangeStore, marketLocation, resolveLongRangeMarket, LongRangeLeaseError, LONG_RANGE_VERSION, type LongRangeState } from "./long-range-store";
import { CLAUDE_ASSESSMENT_VERSION } from "./anthropic-batches";
import { collectionWindow, publishLongRangeResult, type CollectionContext } from "./run";
import { longRangeWindow, marketWindow } from "./sources/claude";
import { collectLongRange } from "./sources/long-range";
import type { SourceResult } from "./types";
import { searchDue } from "./schedule";

export type MarketWork = {
  kind: "market-research" | "market-publication";
  accountId: string;
  areaId: string;
  runId: string;
  requestedAt: string;
};

export function storedLongRangeResult(state: LongRangeState | null, now = new Date()): SourceResult {
  const horizon = longRangeWindow(marketWindow(collectionWindow(now)));
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
  const market = await resolveLongRangeMarket(context.area.searchLocation, context.area.radiusKm);
  const state = await createLongRangeStore().load(market.key);
  if (state?.research?.completedAt && !state.publicationPending && !state.cycle?.pending
    && state.version === LONG_RANGE_VERSION * 1000 + CLAUDE_ASSESSMENT_VERSION
    && !searchDue(state.research.requestedAt)) {
    return { ...storedLongRangeResult(state), researchPending: false };
  }
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
  const { data: activeArea, error: activeAreaError } = await admin.from("collection_areas")
    .select("id, hotels!inner(archived_at)").eq("id", work.areaId).eq("account_id", work.accountId)
    .is("hotels.archived_at", null).maybeSingle();
  if (activeAreaError) throw activeAreaError;
  if (!activeArea) return;
  const context = await repository.loadContext(work.accountId, work.areaId);
  if (!context.area.enabledSources.includes("claude")) return;
  const market = await resolveLongRangeMarket(context.area.searchLocation, context.area.radiusKm);
  const key = market.key;
  // Called under the research or publication lease; partial publication never marks
  // the research complete, and waits for an overlapping hotel refresh.
  async function publishState(state: LongRangeState) {
    const { data: areas, error: areaError } = await admin.from("collection_areas").select("id, account_id, search_location, radius_km, accounts!inner(active), hotels!inner(archived_at)").is("hotels.archived_at", null).eq("accounts.active", true).contains("enabled_sources", ["claude"]);
    if (areaError) throw areaError;
    // Every hotel this research covers, not only the one whose radius happens to match it: the
    // editions are a superset and `publishLongRangeResult` filters each hotel by real distance.
    const matching = areas.filter((area) =>
      marketLocation(area.search_location) === market.location && area.radius_km <= market.radiusKm);
    if (matching.length) {
      const { data: refreshing, error } = await admin.from("collection_runs").select("id").in("collection_area_id", matching.map((area) => area.id)).is("finished_at", null).limit(1);
      if (error) throw error;
      if (refreshing.length) return false;
    }
    const result = storedLongRangeResult(state);
    const publication: Record<string, number> = {};
    for (const area of matching) {
      const counts = await publishLongRangeResult(repository, await repository.loadContext(area.account_id, area.id), result);
      for (const [name, count] of Object.entries(counts ?? {})) publication[name] = (publication[name] ?? 0) + count;
    }
    if (state.research) state.research.usage = { ...state.research.usage, ...result.usage, ...publication };
    return matching;
  }
  if (work.kind === "market-research") {
    // Research runs at the market's radius, not this hotel's: a wider host already covers it, and
    // narrowing the search would strand every hotel that is riding the same market.
    await collectLongRange({
      ...longRangeWindow(marketWindow(collectionWindow())), location: market.location, radiusKm: market.radiusKm,
      seeds: context.longRangeSeeds, batching: { enabled: process.env.ANTHROPIC_BATCHES !== "disabled" },
      requestedAt: work.requestedAt, fastFirstSearch: true,
      onProgress: async (state) => Boolean(await publishState(state)),
      onUsage: (usage) => repository.recordUsage(work.runId, "claude", usage),
    });
    const { publishCollectionJob } = await import("./jobs");
    await publishCollectionJob({ ...work, kind: "market-publication" });
    return;
  }
  // Publication has its own retry and never calls an AI collector. The market lease prevents
  // clearing the publication marker while another worker is saving newer editions.
  const store = createLongRangeStore();
  if (!await store.acquire(key, market)) throw new LongRangeLeaseError();
  try {
    const state = await store.load(key);
    if (!state) return;
    if (!state.research?.completedAt || state.cycle?.pending) throw new Error("Publication waits for research to finish");
    const matching = await publishState(state);
    if (!matching) throw new Error("Publication waits for the active hotel refresh to finish before applying newer evidence");
    state.publicationPending = false;
    state.publishedAt = new Date().toISOString();
    await store.save(key, state);
    // Only final publication prepares mail. If staging fails, this publication
    // message retries without buying research or losing the unsent notification.
    const { stageHotelEventNotifications } = await import("@/features/notifications/service");
    for (const area of matching) await stageHotelEventNotifications(area.account_id, area.id);
  } finally {
    await store.release(key);
  }
}

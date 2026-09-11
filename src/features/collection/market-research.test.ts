import { describe, expect, it, vi } from "vitest";
import { readAndEnqueueResearch, storedLongRangeResult, processMarketWork } from "./market-research";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import { createCollectionRepository } from "./repository";
import { publishCollectionJob } from "./jobs";
import { collectLongRange } from "./sources/long-range";
import { coveringMarket, createLongRangeStore, type MarketRow } from "./long-range-store";
import type { CollectionContext } from "./run";
import fixture from "../../../tests/fixtures/the-match-repair.json";

vi.mock("./jobs", () => ({ publishCollectionJob: vi.fn(async () => {}) }));
vi.mock("./sources/long-range", () => ({ collectLongRange: vi.fn() }));
vi.mock("./long-range-store", async (actual) => ({ ...await actual<object>(), createLongRangeStore: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("./repository", () => ({ createCollectionRepository: vi.fn() }));

/**
 * `resolveLongRangeMarket` reads the markets table to find a wider city research this hotel can
 * ride, so the double has to answer an awaited query, not only `maybeSingle`.
 */
function adminStub(markets: MarketRow[] = []) {
  const query: Record<string, unknown> = {
    maybeSingle: vi.fn(async () => ({ data: { id: "account" }, error: null })),
    then: (resolve: (value: { data: unknown; error: null }) => unknown) => resolve({ data: markets, error: null }),
  };
  for (const method of ["select", "eq", "gte", "order", "limit", "update", "is"]) query[method] = vi.fn(() => query);
  vi.mocked(createAdminClient).mockReturnValue({ from: () => query } as unknown as AdminClient);
  return query;
}

describe("hotel refresh and shared research separation", () => {
  it.each(["disabled", "enabled"])("applies the %s batch setting to background research too", async setting => {
    vi.stubEnv("ANTHROPIC_BATCHES", setting);
    adminStub();
    vi.mocked(createCollectionRepository).mockReturnValue({ loadContext: async () => ({ area: { searchLocation: "Eindhoven", radiusKm: 25, enabledSources: ["claude"] } }) } as unknown as ReturnType<typeof createCollectionRepository>);
    try {
      await processMarketWork({ kind: "market-research", accountId: "account", areaId: "area", runId: "run", requestedAt: "2026-09-09T12:00:00Z" });
      expect(collectLongRange).toHaveBeenLastCalledWith(expect.objectContaining({ batching: { enabled: setting !== "disabled" } }));
    } finally { vi.unstubAllEnvs(); vi.mocked(collectLongRange).mockClear(); }
  });
  it("returns stored editions after durable enqueue without waiting for research", async () => {
    const state = { version: 2003, discoveredAt: null, leads: [fixture.lead] } as Parameters<typeof storedLongRangeResult>[0];
    adminStub();
    const store = { load: vi.fn(async () => state) };
    vi.mocked(createLongRangeStore).mockReturnValue(store as unknown as ReturnType<typeof createLongRangeStore>);
    const context = { area: { id: "area", accountId: "account", searchLocation: "Eindhoven", radiusKm: 25 } } as CollectionContext;
    const result = await readAndEnqueueResearch(context, "refresh-run");
    expect(publishCollectionJob).toHaveBeenCalledWith(expect.objectContaining({ kind: "market-research", accountId: "account", areaId: "area", runId: "refresh-run" }));
    expect(result.researchPending).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(result.requests).toBe(0);
    expect(collectLongRange).not.toHaveBeenCalled();
    vi.mocked(publishCollectionJob).mockRejectedValueOnce(new Error("Queue unavailable"));
    await expect(readAndEnqueueResearch(context, "retry-run")).rejects.toThrow("Queue unavailable");
  });

  it("keeps conflicted editions quarantined while retaining confirmed editions after a fetch failure", () => {
    const lead = structuredClone(fixture.lead);
    const state = { version: 2003, discoveredAt: null, leads: [lead] } as Parameters<typeof storedLongRangeResult>[0];
    lead.outcome = "failed";
    expect(storedLongRangeResult(state).candidates).toHaveLength(1);
    lead.outcome = "conflict";
    const result = storedLongRangeResult(state);
    expect(result.candidates).toEqual([]);
    expect(result.quarantinedProviderEventIds).toEqual([lead.editions[0].providerEventId]);
  });

  it("withholds a reversed date range without blocking valid siblings or deleting research", () => {
    const lead = structuredClone(fixture.lead);
    lead.editions.push({ ...lead.editions[0], providerEventId: "invalid-range", startAt: "2027-04-11T22:00:00Z", endAt: "2027-04-11T21:59:59Z" });
    const result = storedLongRangeResult({ version: 2003, discoveredAt: null, leads: [lead] } as Parameters<typeof storedLongRangeResult>[0]);
    expect(result.candidates).toHaveLength(1);
    expect(result.quarantinedProviderEventIds).toEqual(["invalid-range"]);
    expect(result.usage.invalidDateEditions).toBe(1);
    expect(lead.editions).toHaveLength(2);
  });

  it("rides the narrowest city market that still covers the hotel", () => {
    const markets: MarketRow[] = [
      { market_key: "eindhoven-15", search_location: "eindhoven", radius_km: 15 },
      { market_key: "eindhoven-25", search_location: "eindhoven", radius_km: 25 },
      { market_key: "eindhoven-50", search_location: "eindhoven", radius_km: 50 },
      { market_key: "utrecht-50", search_location: "utrecht", radius_km: 50 },
    ];
    // 25 km is covered by the 25 and the 50; the tighter one wastes the least verification.
    expect(coveringMarket(markets, "Eindhoven", 25)?.market_key).toBe("eindhoven-25");
    expect(coveringMarket(markets, " EINDHOVEN ", 20)?.market_key).toBe("eindhoven-25");
    expect(coveringMarket(markets, "Eindhoven", 30)?.market_key).toBe("eindhoven-50");
    // Nothing looked 100 km out, and a neighbouring city never covers this one.
    expect(coveringMarket(markets, "Eindhoven", 100)).toBeNull();
    expect(coveringMarket(markets, "Heeze", 15)).toBeNull();
    // A market saved before the columns existed cannot be matched on a city.
    expect(coveringMarket([{ market_key: "legacy", search_location: null, radius_km: null }], "Eindhoven", 25)).toBeNull();
  });

  it("publishes one market's research to every narrower hotel in the city", async () => {
    const areas = [
      { id: "own", account_id: "a", search_location: "Eindhoven", radius_km: 25 },
      { id: "narrower", account_id: "b", search_location: "eindhoven", radius_km: 15 },
      { id: "wider", account_id: "c", search_location: "Eindhoven", radius_km: 50 },
      { id: "other-city", account_id: "d", search_location: "Utrecht", radius_km: 15 },
    ];
    const published: string[] = [];
    const query: Record<string, unknown> = {
      maybeSingle: vi.fn(async () => ({ data: { id: "account" }, error: null })),
      then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
        resolve({ data: query.table === "collection_areas" ? areas : [], error: null }),
    };
    for (const method of ["select", "eq", "gte", "order", "limit", "update", "is", "in", "contains"]) query[method] = vi.fn(() => query);
    vi.mocked(createAdminClient).mockReturnValue({
      from: (table: string) => { query.table = table; return query; },
    } as unknown as AdminClient);
    vi.mocked(createLongRangeStore).mockReturnValue({
      acquire: vi.fn(async () => true),
      release: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
      load: vi.fn(async () => ({ version: 2003, discoveredAt: null, leads: [], publicationPending: true })),
    } as unknown as ReturnType<typeof createLongRangeStore>);
    vi.mocked(createCollectionRepository).mockReturnValue({
      loadContext: async (_account: string, areaId: string) => {
        published.push(areaId);
        return { area: { id: areaId, searchLocation: "Eindhoven", radiusKm: 25, enabledSources: ["claude"] }, hotels: [] };
      },
      recalculateScores: async () => ({}),
    } as unknown as ReturnType<typeof createCollectionRepository>);

    await processMarketWork({ kind: "market-publication", accountId: "a", areaId: "own", runId: "run", requestedAt: "2026-09-11T12:00:00Z" });

    // The first loadContext is the market's own area; the rest are the hotels it publishes to.
    expect(published.slice(1).sort()).toEqual(["narrower", "own"]);
  });
});

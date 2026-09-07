import { describe, expect, it, vi } from "vitest";
import { readAndEnqueueResearch, storedLongRangeResult } from "./market-research";
import { publishCollectionJob } from "./jobs";
import { collectLongRange } from "./sources/long-range";
import { createLongRangeStore } from "./long-range-store";
import type { CollectionContext } from "./run";
import fixture from "../../../tests/fixtures/the-match-repair.json";

vi.mock("./jobs", () => ({ publishCollectionJob: vi.fn(async () => {}) }));
vi.mock("./sources/long-range", () => ({ collectLongRange: vi.fn() }));
vi.mock("./long-range-store", async (actual) => ({ ...await actual<object>(), createLongRangeStore: vi.fn() }));

describe("hotel refresh and shared research separation", () => {
  it("returns stored editions after durable enqueue without waiting for research", async () => {
    const state = { version: 2003, discoveredAt: null, leads: [fixture.lead] } as Parameters<typeof storedLongRangeResult>[0];
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
});

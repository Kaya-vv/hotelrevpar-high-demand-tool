import { expect, it, vi } from "vitest";
import { getCollectionStatus } from "./status";
import { createServerClient } from "@/lib/supabase/server";
import { getMarketProgress, marketKeyResolver } from "./market-status";

vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("./market-status", () => ({ getMarketProgress: vi.fn(), marketKeyResolver: vi.fn() }));

it("refreshes a narrower hotel's calendar on partial publication without declaring research finished", async () => {
  const start = "2026-09-14T12:00:00Z";
  vi.mocked(createServerClient).mockResolvedValue({ from: (table: string) => {
    const query: Record<string, unknown> = {
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: unknown) => unknown) => resolve({ error: null, data: table === "collection_runs"
        ? [{ id: "run", collection_area_id: "area", started_at: start, finished_at: start, requested: true }]
        : [{ id: "area", search_location: "Eindhoven", radius_km: 15 }] }),
    };
    for (const method of ["select", "eq", "order", "limit", "in", "range"]) query[method] = () => query;
    return query;
  } } as unknown as Awaited<ReturnType<typeof createServerClient>>);
  vi.mocked(marketKeyResolver).mockResolvedValue(() => "covering-25km-market");
  vi.mocked(getMarketProgress).mockResolvedValue(new Map([["covering-25km-market", {
    publishedAt: undefined, progressPublishedAt: undefined, publicationPending: true, research: { requestedAt: start },
  }]]));
  const before = await getCollectionStatus("account", "area");
  vi.mocked(getMarketProgress).mockResolvedValue(new Map([["covering-25km-market", {
    publishedAt: undefined, progressPublishedAt: "2026-09-14T12:03:00Z", publicationPending: true, research: { requestedAt: start },
  }]]));
  const partial = await getCollectionStatus("account", "area");
  expect(getMarketProgress).toHaveBeenLastCalledWith(["covering-25km-market"]);
  expect(before.pending).toBe(true);
  expect(partial.pending).toBe(true);
  expect(partial.revision).not.toBe(before.revision);
  expect((await getCollectionStatus("account", "area")).revision).toBe(partial.revision);
});

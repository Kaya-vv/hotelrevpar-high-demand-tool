import { describe, expect, it, vi } from "vitest";

import { createServerClient } from "@/lib/supabase/server";
import { getDashboardData } from "./query";

vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }));

describe("dashboard hotel status", () => {
  it.each([
    { jobStatus: "partial", fatalError: null, expected: "idle" },
    { jobStatus: "succeeded", fatalError: null, expected: "idle" },
    { jobStatus: "failed", fatalError: null, expected: "attention" },
    { jobStatus: "partial", fatalError: "Score persistence failed", expected: "attention" },
    { jobStatus: "queued", fatalError: null, expected: "running" },
    { jobStatus: "running", fatalError: null, expected: "running" },
  ])("returns $expected for $jobStatus with fatal error $fatalError", async ({ jobStatus, fatalError, expected }) => {
    const rows: Record<string, unknown[]> = {
      hotels: [{ id: "hotel-1", name: "Groningen" }],
      collection_areas: [{ id: "area-1", hotel_id: "hotel-1" }],
      collection_runs: [{
        collection_area_id: "area-1",
        finished_at: "2026-09-04T12:56:03Z",
        error_summary: fatalError,
        source_results: {
          claude: { state: "partial", error: "longRange: Official fetch returned HTTP 404 or non-HTML content" },
        },
      }],
      collection_jobs: [{ collection_area_id: "area-1", status: jobStatus }],
    };
    const from = vi.fn((table: string) => {
      if (table === "collection_areas") rows[table] = [{ id: "area-1", hotel_id: "hotel-1", collection_runs: rows.collection_runs, collection_jobs: rows.collection_jobs }];
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve),
      };
      return query;
    });
    vi.mocked(createServerClient).mockResolvedValue({ from } as unknown as Awaited<ReturnType<typeof createServerClient>>);

    expect(await getDashboardData("account-1")).toMatchObject([{
      id: "hotel-1",
      status: expected,
      updatedAt: "2026-09-04T12:56:03Z",
    }]);
  });
});

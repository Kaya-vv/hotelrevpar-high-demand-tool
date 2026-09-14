import { describe, expect, it, vi } from "vitest";

import { createServerClient } from "@/lib/supabase/server";
import { unresolvedEventLocations } from "./unresolved-locations";

vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }));

const evidence = {
  dateText: "17 tot en met 25 oktober 2026",
  locationText: "",
  hostCity: null,
  locationScope: "unknown",
  continuous: true,
  majorCompetition: false,
  demand: [],
  dateSourceUrl: "https://example.com/event",
  checkedAt: "2026-09-14T12:00:00Z",
};

describe("unresolved event locations", () => {
  it("returns only open reports with their intended local event dates", async () => {
    const rows = [
      {
        collection_area_id: "area-1",
        provider: "claude",
        provider_event_id: "open-1",
        horizon: "near_term",
        title: "Dutch Design Week",
        venue: "Klokgebouw",
        start_at: "2026-10-16T22:00:00+00:00",
        end_at: "2026-10-25T23:59:59+00:00",
        discovered_at: "2026-09-14T12:00:00Z",
        resolved_at: null,
        candidate: {
          sourceUrl: "https://example.com/event",
          evidence,
        },
      },
      {
        collection_area_id: "area-1",
        provider: "claude",
        provider_event_id: "resolved-1",
        horizon: "near_term",
        title: "Al afgehandeld",
        venue: null,
        start_at: "2026-10-01T00:00:00Z",
        end_at: "2026-10-01T23:59:59Z",
        discovered_at: "2026-09-13T12:00:00Z",
        resolved_at: "2026-09-14T08:00:00Z",
        candidate: { sourceUrl: "https://example.com/resolved", evidence },
      },
    ];
    const from = vi.fn((table: string) => {
      let openOnly = false;
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        is: vi.fn((column: string, value: unknown) => {
          openOnly = column === "resolved_at" && value === null;
          return query;
        }),
        then: (resolve: (value: unknown) => unknown) => {
          const data =
            table === "collection_areas"
              ? [{ id: "area-1", name: "Eindhoven" }]
              : openOnly
                ? rows.filter((row) => row.resolved_at === null)
                : rows;
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return query;
    });
    vi.mocked(createServerClient).mockResolvedValue({ from } as never);

    expect(await unresolvedEventLocations("account-1")).toEqual([
      {
        areaId: "area-1",
        areaName: "Eindhoven",
        provider: "claude",
        providerEventId: "open-1",
        horizon: "near_term",
        title: "Dutch Design Week",
        venue: "Klokgebouw",
        startDate: "2026-10-17",
        endDate: "2026-10-25",
        discoveredAt: "2026-09-14T12:00:00Z",
        sourceUrl: "https://example.com/event",
        locationText: null,
        hostCity: null,
      },
    ]);
  });
});

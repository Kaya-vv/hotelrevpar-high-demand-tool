import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCalendarData } from "@/features/calendar/query";

import { loadVisibleNotificationEvents } from "./query";

const { tables, database } = vi.hoisted(() => {
  const tables: Record<string, Record<string, unknown>[]> = {};
  const database = {
    from: (table: string) => {
      let rows = tables[table] ?? [];
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          rows = rows.filter((row) => row[key] === value);
          return query;
        },
        in: (key: string, values: unknown[]) => {
          rows = rows.filter((row) => values.includes(row[key]));
          return query;
        },
        order: () => query,
        range: (from: number, to: number) => {
          rows = rows.slice(from, to + 1);
          return query;
        },
        limit: () => query,
        maybeSingle: () =>
          Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return query;
    },
  };
  return { tables, database };
});

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => database,
}));
vi.mock("@/features/workspace/hotel-context", () => ({
  getHotelScope: async () => ({
    supabase: database,
    hotels: [{ id: "hotel", name: "The Match", demand_radius_km: 25 }],
    selectedHotelId: "hotel",
    areaId: "area",
    enabledSources: ["claude"],
  }),
}));
vi.mock("@/features/export/history", () => ({
  calendarExportDates: async () => new Map(),
}));

function addEvent(input: {
  id: string;
  level?: "Low" | "Medium" | "High" | "Peak";
  impactBasis?: string;
  start?: string;
  end?: string;
  certainty?: string;
  state?: string;
  mergedInto?: string;
  supported?: boolean;
  distanceKm?: number;
  category?: string;
  overrides?: Record<string, unknown>;
}) {
  const start = input.start ?? "2027-06-10";
  const end = input.end ?? start;
  tables.account_events.push({
    account_id: "account",
    event_id: input.id,
    state: input.state ?? "active",
    merged_into_event_id: input.mergedInto ?? null,
    ...input.overrides,
  });
  tables.account_event_areas.push({
    account_id: "account",
    event_id: input.id,
    collection_area_id: "area",
  });
  tables.events.push({
    id: input.id,
    title: input.id,
    venue: "Venue",
    certainty: input.certainty ?? "confirmed",
    category: input.category ?? "conference",
    start_at: `${start}T10:00:00Z`,
    end_at: `${end}T20:00:00Z`,
  });
  tables.event_sources.push({
    event_id: input.id,
    provider: "claude",
    source_state: "active",
    primary_source_confirmed: input.supported ?? true,
    public_source_url: "https://example.com/event",
    evidence: {
      dateText: "10 juni 2027",
      locationText: "Eindhoven",
      hostCity: "Eindhoven",
      locationScope: "venue",
      continuous: true,
      majorCompetition: false,
      demand: [],
      dateSourceUrl: "https://example.com/event",
      checkedAt: "2026-09-08T12:00:00Z",
    },
  });
  tables.hotel_event_scores.push({
    event_id: input.id,
    hotel_id: "hotel",
    suggested_importance: input.level ?? "High",
    importance_override: null,
    impact_basis: input.impactBasis ?? "demand_rule",
    total: 75,
    distance_km: input.distanceKm ?? 2,
    demand_assessment: null,
  });
}

describe("notification calendar parity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
    for (const name of [
      "account_events",
      "account_event_areas",
      "events",
      "event_sources",
      "hotel_event_scores",
      "collection_runs",
    ]) {
      tables[name] = [];
    }
    tables.hotels = [
      {
        id: "hotel",
        account_id: "account",
        name: "The Match",
        demand_radius_km: 25,
      },
    ];
    tables.collection_areas = [
      {
        id: "area",
        account_id: "account",
        hotel_id: "hotel",
        enabled_sources: ["claude"],
      },
    ];
  });

  afterEach(() => vi.useRealTimers());

  it("emails exactly the entries shown on the hotel calendar", async () => {
    addEvent({ id: "high" });
    addEvent({ id: "peak", level: "Peak" });
    addEvent({
      id: "announced",
      level: "Medium",
      impactBasis: "default",
      end: "2027-06-12",
    });
    addEvent({ id: "low", level: "Low", start: "2026-10-01" });
    addEvent({ id: "provisional", certainty: "provisional" });
    addEvent({ id: "unsupported", supported: false });
    addEvent({
      id: "out-of-radius",
      level: "Medium",
      impactBasis: "default",
      end: "2027-06-12",
      distanceKm: 80,
    });
    addEvent({ id: "review", state: "needs_review" });
    addEvent({ id: "duplicate", mergedInto: "high" });
    addEvent({
      id: "override-announced",
      level: "Medium",
      impactBasis: "default",
      start: "2026-10-01",
      overrides: {
        override_start_at: "2027-08-01T10:00:00Z",
        override_end_at: "2027-08-03T20:00:00Z",
      },
    });

    const calendar = await getCalendarData("account", {
      month: "2026-09",
      view: "list",
      period: "all",
    });
    const notification = await loadVisibleNotificationEvents(
      database as never,
      "account",
      "hotel",
      new Date(),
    );

    expect(notification?.events.map((event) => event.id)).toEqual(
      calendar.events.map((event) => event.id),
    );
    expect(notification?.events.map((event) => event.id)).toEqual([
      "announced",
      "high",
      "peak",
      "override-announced",
    ]);
    expect(notification?.events.map((event) => event.level)).toEqual([
      "Aangekondigd",
      "Hoog",
      "Piek",
      "Aangekondigd",
    ]);
  });
});

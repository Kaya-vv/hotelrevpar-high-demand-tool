import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCalendarData } from "./query";

const { tables, database } = vi.hoisted(() => {
  const tables: Record<string, Record<string, unknown>[]> = {};
  const database = { from: (table: string) => {
    let rows = tables[table] ?? [];
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { rows = rows.filter((row) => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { rows = rows.filter((row) => values.includes(row[key])); return query; },
      order: () => query,
      range: (from: number, to: number) => { rows = rows.slice(from, to + 1); return query; },
      limit: () => query,
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return query;
  } };
  return { tables, database };
});

vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => database }));
vi.mock("@/features/workspace/hotel-context", () => ({ getHotelScope: async () => ({
  supabase: database, hotels: [{ id: "hotel", name: "Hotel", demand_radius_km: 25 }], selectedHotelId: "hotel", areaId: "area", enabledSources: ["claude"],
}) }));
vi.mock("@/features/export/history", () => ({ calendarExportDates: async () => new Map([["future", "2026-09-01T12:00:00Z"]]) }));

function addEvent(id: string, start: string, end = start, overrides = {}) {
  tables.account_events.push({ account_id: "account", event_id: id, state: "active", ...overrides });
  tables.account_event_areas.push({ account_id: "account", event_id: id, collection_area_id: "area" });
  tables.events.push({ id, title: id, certainty: "confirmed", category: "concert", start_at: `${start}T12:00:00Z`, end_at: `${end}T20:00:00Z` });
  tables.event_sources.push({ event_id: id, provider: "claude", source_state: "active", primary_source_confirmed: true, public_source_url: "https://example.com/event" });
  tables.hotel_event_scores.push({ event_id: id, hotel_id: "hotel", suggested_importance: "High", impact_basis: "attendance", total: 80 });
}

describe("calendar query periods", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
    for (const name of ["account_events", "account_event_areas", "events", "event_sources", "hotel_event_scores", "collection_runs"]) tables[name] = [];
  });
  afterEach(() => vi.useRealTimers());

  it("includes ongoing and year-ahead events, applies overrides before overlap and retains export badges", async () => {
    addEvent("past", "2026-08-01");
    addEvent("ongoing", "2026-09-01", "2026-09-10");
    addEvent("future", "2027-12-31");
    addEvent("outside", "2028-01-01");
    addEvent("moved-in", "2026-08-01", "2026-08-01", { override_start_at: "2027-01-01T12:00:00Z", override_end_at: "2027-01-01T20:00:00Z" });
    addEvent("moved-out", "2027-01-01", "2027-01-01", { override_start_at: "2028-01-01T12:00:00Z", override_end_at: "2028-01-01T20:00:00Z" });
    const result = await getCalendarData("account", { month: "2026-09", view: "list", period: "all" });
    expect(result.events.map((event) => event.id)).toEqual(["ongoing", "moved-in", "future"]);
    expect(result.events[2].exportedAt).toBe("2026-09-01T12:00:00Z");
    expect(result.selectedHotelId).toBe("hotel");
    expect((await getCalendarData("account", { month: "2026-09", view: "list", period: "3" })).events.map((event) => event.id)).toEqual(["ongoing"]);
    expect((await getCalendarData("account", { month: "2027-01", view: "calendar" })).events.map((event) => event.id)).toEqual(["moved-in"]);
  });

  it("loads all pages for a full horizon and retains publication and hotel checks", async () => {
    for (let index = 0; index < 501; index++) addEvent(`event-${index}`, "2027-01-01");
    tables.hotel_event_scores[0].suggested_importance = "Medium";
    tables.hotel_event_scores[1].hotel_id = "other-hotel";
    tables.event_sources[2].primary_source_confirmed = false;
    tables.account_events[3].account_id = "other-account";
    const result = await getCalendarData("account", { month: "2026-09", view: "list" });
    expect(result.events).toHaveLength(497);
    expect(result.events.some((event) => event.id === "event-500")).toBe(true);
  });
});

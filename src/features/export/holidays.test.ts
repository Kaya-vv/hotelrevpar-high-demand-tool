import { beforeEach, expect, it, vi } from "vitest";

import { exportedLevel } from "./selection";
import { loadExportEvents } from "./query";
import type { ServerClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }));

let tables: Record<string, Record<string, unknown>[]>;
const client = { from: (table: string) => {
  let rows = tables[table] ?? [];
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => { rows = rows.filter((row) => row[key] === value); return query; },
    is: (key: string, value: unknown) => { rows = rows.filter((row) => (row[key] ?? null) === value); return query; },
    in: (key: string, values: unknown[]) => { rows = rows.filter((row) => values.includes(row[key])); return query; },
    order: () => query,
    range: (from: number, to: number) => { rows = rows.slice(from, to + 1); return query; },
    single: () => Promise.resolve({ data: rows[0], error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  return query;
} } as unknown as ServerClient;

const hotels = [
  { id: "north", region: "north" },
  { id: "middle", region: "middle" },
];

function addHoliday(id: string, category: string, regionScope: string, start: string, end = start) {
  tables.events.push({ id, title: id, category, region_scope: regionScope, certainty: "confirmed", source_state: "active",
    start_at: `${start}T00:00:00Z`, end_at: `${end}T23:59:59Z` });
  tables.account_events.push({ account_id: "account", event_id: id, state: "active", merged_into_event_id: null });
  tables.event_sources.push({ event_id: id, provider: category === "public_holiday" ? "openholidays" : "rijksoverheid",
    source_state: "active", primary_source_confirmed: true, public_source_url: "https://www.rijksoverheid.nl/" });
  for (const hotel of hotels) {
    tables.account_event_areas.push({ account_id: "account", event_id: id, collection_area_id: `area-${hotel.id}` });
    tables.hotel_event_scores.push({ event_id: id, hotel_id: hotel.id, suggested_importance: "Medium", importance_override: null,
      impact_basis: "holiday_rule", distance_km: null,
      demand_assessment: { version: 1, relevance: "not_relevant", magnitude: null, confidence: "low", reasons: [], sourceUrls: [] } });
  }
}

async function sent(minLevel: "Medium" | "High" = "High") {
  const { events } = await loadExportEvents("account", { start: "2027-01-01", end: "2027-12-31" }, hotels.map((hotel) => hotel.id), false, client);
  return Object.fromEntries(hotels.map((hotel) => [hotel.id, events.flatMap((event) => {
    const row = event.hotels.find((candidate) => candidate.id === hotel.id);
    const level = row && exportedLevel(row, minLevel);
    return level ? [`${event.title}:${level}`] : [];
  }).sort()]));
}

beforeEach(() => {
  tables = {
    accounts: [{ id: "account", export_public_holidays: false, export_school_holidays: false }],
    hotels: hotels.map((hotel) => ({ id: hotel.id, name: hotel.id, revcontrol_code: hotel.id.toUpperCase(), demand_radius_km: 25,
      holiday_region: hotel.region, account_id: "account", archived_at: null })),
    collection_areas: hotels.map((hotel) => ({ id: `area-${hotel.id}`, hotel_id: hotel.id, account_id: "account",
      enabled_sources: ["openholidays", "rijksoverheid"] })),
    account_event_areas: [], account_events: [], events: [], event_sources: [], hotel_event_scores: [],
    hotel_event_exports: [], export_batches: [],
  };
  addHoliday("Koningsdag", "public_holiday", "national", "2027-04-27");
  addHoliday("Meivakantie", "school_holiday", "national", "2027-04-24", "2027-05-02");
  addHoliday("Zomervakantie Noord", "school_holiday", "north", "2027-07-10", "2027-08-22");
  addHoliday("Zomervakantie Midden", "school_holiday", "middle", "2027-07-17", "2027-08-29");
});

it("sends no holidays until the account chooses to", async () => {
  expect(await sent("Medium")).toEqual({ north: [], middle: [] });
});

it("sends public holidays as High to every hotel, even when the account sends only High and Peak", async () => {
  tables.accounts[0].export_public_holidays = true;
  expect(await sent("High")).toEqual({ north: ["Koningsdag:High"], middle: ["Koningsdag:High"] });
});

it("sends every region's school holiday to every hotel", async () => {
  tables.accounts[0].export_school_holidays = true;
  const all = ["Meivakantie:High", "Zomervakantie Midden:High", "Zomervakantie Noord:High"];
  expect(await sent()).toEqual({ north: all, middle: all });
});

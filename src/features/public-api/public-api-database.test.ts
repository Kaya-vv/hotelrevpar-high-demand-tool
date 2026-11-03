import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

import { createEventsHandler, createHotelsHandler } from "./handlers";
import { generateApiKey } from "./keys";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }));
const enabled = Boolean(process.env.RESEARCH_LOCAL_KEY);
const db = createClient<Database>("http://127.0.0.1:54421", process.env.RESEARCH_LOCAL_KEY ?? "disabled", { auth: { persistSession: false } });
const accountId = randomUUID(), pairAccount = randomUUID(), inactiveAccount = randomUUID(), expiredAccount = randomUUID();
const hotelId = randomUUID(), archivedHotel = randomUUID(), pairHotels = [randomUUID(), randomUUID()];
const eventIds: string[] = [];
const keys = { main: generateApiKey(), revoked: generateApiKey(), pair: generateApiKey(), inactive: generateApiKey(), expired: generateApiKey() };
function check<T extends { error: unknown }>(result: T): T { if (result.error) throw result.error; return result; }

const now = () => new Date("2026-11-03T08:00:00Z");
const hotels = createHotelsHandler({ client: () => db, now });
const events = createEventsHandler({ client: () => db, now });
const get = (handler: (request: Request) => Promise<Response>, path: string, key = keys.main.key) =>
  handler(new Request(`http://localhost/api/v1/${path}`, { headers: { authorization: `Bearer ${key}` } }));
const june = (extra = "") => get(events, `events?from=2027-06-01&to=2027-06-30${extra}`);

function hotel(id: string, account: string, archived = false) {
  return { id, account_id: account, name: `Hotel ${id}`, address: "Markt 1, Eindhoven", revcontrol_code: `RC-${id.slice(0, 4)}`, latitude: 51.44, longitude: 5.48,
    demand_radius_km: 25, search_location: "Eindhoven", enabled_sources: ["claude"], archived_at: archived ? "2026-10-01T00:00:00Z" : null };
}

beforeAll(async () => {
  if (!enabled) return;
  check(await db.from("accounts").insert([
    { id: accountId, name: "API test", active: true, trial_ends_at: null }, { id: pairAccount, name: "API pair", active: true, trial_ends_at: null },
    { id: inactiveAccount, name: "API inactive", active: false, trial_ends_at: null }, { id: expiredAccount, name: "API expired", active: true, trial_ends_at: "2026-10-01T00:00:00Z" },
  ]));
  check(await db.from("hotels").insert([hotel(hotelId, accountId), hotel(archivedHotel, accountId, true), ...pairHotels.map((id) => hotel(id, pairAccount))]));
  const keyRow = (key: typeof keys.main, account: string, revoked = false) =>
    ({ account_id: account, name: "test", key_prefix: key.prefix, key_hash: key.hash, revoked_at: revoked ? "2026-11-01T00:00:00Z" : null });
  check(await db.from("api_keys").insert([keyRow(keys.main, accountId), keyRow(keys.revoked, accountId, true), keyRow(keys.pair, pairAccount),
    keyRow(keys.inactive, inactiveAccount), keyRow(keys.expired, expiredAccount)]));
});
afterAll(async () => {
  if (!enabled) return;
  check(await db.from("accounts").delete().in("id", [accountId, pairAccount, inactiveAccount, expiredAccount]));
  if (eventIds.length) check(await db.from("events").delete().in("id", eventIds));
});

async function addEvent(title: string, level: string, start = "2027-06-10T12:00:00+02:00", end = "2027-06-10T23:00:00+02:00") {
  const id = randomUUID(); eventIds.push(id);
  check(await db.from("events").insert({ id, normalized_identity: id, title, category: "concert", venue: "Philips Stadion", region_scope: "Eindhoven", latitude: 51.44, longitude: 5.47, start_at: start, end_at: end, certainty: "confirmed" }));
  check(await db.from("account_events").insert({ account_id: accountId, event_id: id, state: "active" }));
  check(await db.from("event_sources").insert({ event_id: id, provider: "claude", provider_event_id: id, source_url: "https://arena.example/events", public_source_url: "https://arena.example/events", extracted_title: title, extracted_start_at: start, source_state: "active", certainty: "confirmed", primary_source_confirmed: true, evidence: { dateText: "10 June 2027", locationText: "Eindhoven", hostCity: "Eindhoven", locationScope: "venue", continuous: false, majorCompetition: false, demand: [], dateSourceUrl: "https://arena.example/events", checkedAt: "2026-09-09" } }));
  const areas = check(await db.from("collection_areas").select("id").eq("hotel_id", hotelId)).data!;
  check(await db.from("account_event_areas").insert(areas.map((area) => ({ account_id: accountId, event_id: id, collection_area_id: area.id }))));
  // A Low event has no sign of hotel guests; with one, the calendar would show it as Medium.
  const relevance = level === "Low" ? "not_relevant" : "supported";
  check(await db.from("hotel_event_scores").insert({ hotel_id: hotelId, event_id: id, distance_km: 1.26, impact_points: 45, distance_points: 20, stay_pressure_points: 0, total: 65, suggested_importance: level, impact_basis: "demand_rule", demand_assessment: { version: 1, relevance, magnitude: level, confidence: "high", reasons: [], sourceUrls: [] } }));
  return id;
}

describe.skipIf(!enabled)("public API v1 in isolated local Supabase", () => {
  it("refuses revoked keys and keys of inactive or expired accounts", async () => {
    expect((await get(hotels, "hotels", keys.revoked.key)).status).toBe(401);
    for (const key of [keys.inactive.key, keys.expired.key]) {
      const response = await get(hotels, "hotels", key);
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("account_inactive");
    }
  });

  it("lists only the key's own, non-archived hotels and records the key's use", async () => {
    const response = await get(hotels, "hotels");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hotels: [{ id: hotelId, name: `Hotel ${hotelId}`, address: "Markt 1, Eindhoven", hotel_code: `RC-${hotelId.slice(0, 4)}` }] });
    const key = check(await db.from("api_keys").select("last_used_at").eq("key_hash", keys.main.hash).single()).data!;
    expect(key.last_used_at).toBe("2026-11-03T08:00:00+00:00");
  });

  it("returns the export selection with all four levels and drops what left the list", async () => {
    const high = await addEvent("Concert", "High");
    const peak = await addEvent("Festival", "Peak");
    check(await db.from("account_events").update({ decided_at: "2030-01-01T00:00:00Z" }).eq("account_id", accountId).eq("event_id", peak));
    const low = await addEvent("Lezing", "Low");
    const excluded = await addEvent("Uitgesloten", "High");
    check(await db.from("account_events").update({ state: "excluded" }).eq("account_id", accountId).eq("event_id", excluded));
    const cancelled = await addEvent("Geannuleerd", "High");
    check(await db.from("events").update({ source_state: "cancelled" }).eq("id", cancelled));
    const overlap = await addEvent("Beurs", "High", "2027-05-28T10:00:00+02:00", "2027-06-02T18:00:00+02:00");
    const manual = await addEvent("Congres", "Medium");
    check(await db.from("hotel_event_scores").update({ importance_override: "High", impact_basis: "default" }).eq("hotel_id", hotelId).eq("event_id", manual));
    const medium = await addEvent("Workshop", "Medium");
    const setToLaag = await addEvent("Kerstmarkt", "Medium");
    check(await db.from("hotel_event_scores").update({ importance_override: "Low" }).eq("hotel_id", hotelId).eq("event_id", setToLaag));

    const response = await june();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ hotel_id: hotelId, from: "2027-06-01", to: "2027-06-30", available_until: "2027-12-31" });
    const byId = new Map<string, Record<string, unknown>>(body.events.map((event: { id: string }) => [event.id, event]));
    expect(byId.get(high)).toEqual({
      id: high, title: "Concert", start_date: "2027-06-10", end_date: "2027-06-10", category: "concert", venue: "Philips Stadion", city: "Eindhoven",
      latitude: 51.44, longitude: 5.47, distance_km: 1.3, level: "High", score: 65, source_url: "https://arena.example/events",
      hotel_code: `RC-${hotelId.slice(0, 4)}`, updated_at: expect.any(String),
    });
    // Untouched by a manager: the event's own last change. Touched later: the manager's decision.
    const stored = check(await db.from("events").select("updated_at").eq("id", high).single()).data!.updated_at;
    expect(byId.get(high)?.updated_at).toBe(new Date(stored).toISOString());
    expect(byId.get(peak)?.updated_at).toBe("2030-01-01T00:00:00.000Z");
    expect(byId.get(peak)?.level).toBe("Peak");
    expect(byId.get(overlap)).toMatchObject({ start_date: "2027-05-28", end_date: "2027-06-02" });
    expect(byId.get(manual)?.level).toBe("High");
    // A shown Medium event goes along by default; one the manager set to Laag does not.
    expect(byId.get(medium)?.level).toBe("Medium");
    for (const missing of [low, excluded, cancelled, setToLaag]) expect(byId.has(missing)).toBe(false);
    expect(body.events[0].id).toBe(overlap);

    const peaks = await (await june("&min_level=peak")).json();
    expect(peaks.events.map((event: { id: string }) => event.id)).toEqual([peak]);
  });

  it("rejects bad parameters and unknown hotels with an error status", async () => {
    const expectError = async (response: Response, status: number, code: string) => {
      expect(response.status).toBe(status);
      expect((await response.json()).error.code).toBe(code);
    };
    await expectError(await june("&min_level=bogus"), 400, "invalid_request");
    await expectError(await get(events, "events?from=2027-02-30&to=2027-03-30"), 400, "invalid_request");
    await expectError(await get(events, "events?from=2027-06-01&to=2027-06-30", keys.pair.key), 400, "hotel_id_required");
    await expectError(await june(`&hotel_id=${pairHotels[0]}`), 404, "hotel_not_found");
    await expectError(await june(`&hotel_id=${archivedHotel}`), 404, "hotel_not_found");
    await expectError(await june("&hotel_id=not-a-uuid"), 404, "hotel_not_found");
  });
});

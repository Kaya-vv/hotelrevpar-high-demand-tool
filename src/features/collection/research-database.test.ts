import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import locations from "../../../tests/fixtures/long-range-locations.json";
import { geocodeCity as recordedCity } from "./research-location";
import pages from "../../../tests/fixtures/long-range-pages.json";
import { verifyEventEvidence, localDateBoundary } from "../events/evidence";
import { createCollectionRepository } from "./repository";
import { runCollection } from "./run";
import { getCalendarData } from "../calendar/query";
import { getHotelScope } from "../workspace/hotel-context";
import { loadExportEvents } from "../export/query";
import { mapRevControlRows } from "../export/map-rows";
import { buildRevControlWorkbook } from "../export/build-workbook";
import { collectLongRange } from "./sources/long-range";
import type { LongRangeState } from "./long-range-store";
import type Anthropic from "@anthropic-ai/sdk";
import type { EventCandidate } from "../events/types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }));
vi.mock("../workspace/hotel-context", () => ({ getHotelScope: vi.fn() }));
const live = process.env.RESEARCH_LIVE_RESULT ? JSON.parse(readFileSync(process.env.RESEARCH_LIVE_RESULT, "utf8")) as { market: { city: string; latitude: number; longitude: number; radiusKm: number }; result: import("./types").SourceResult; output: string } : null;
const enabled = Boolean(process.env.RESEARCH_LOCAL_KEY);
const accountId = randomUUID();
const hotelId = randomUUID();
let areaId: string;
let eventId: string | undefined;
let previousEventId: string | undefined;
const db = createClient<Database>("http://127.0.0.1:54421", process.env.RESEARCH_LOCAL_KEY ?? "disabled", { auth: { persistSession: false } });

beforeAll(async () => {
  if (!enabled) return;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54421");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", process.env.RESEARCH_LOCAL_KEY!);
  const account = await db.from("accounts").insert({ id: accountId, name: `Offline research ${accountId}` });
  if (account.error) throw account.error;
  const hotel = await db.from("hotels").insert({ id: hotelId, account_id: accountId, name: "The Match replay", latitude: live?.market.latitude ?? 51.4372, longitude: live?.market.longitude ?? 5.4774, demand_radius_km: live?.market.radiusKm ?? 25, search_location: live?.market.city ?? "Eindhoven", revcontrol_code: "TEST", enabled_sources: ["claude"] }).select().single();
  if (hotel.error) throw hotel.error;
  const area = await db.from("collection_areas").select("id").eq("hotel_id", hotelId).single();
  if (area.error) throw area.error;
  areaId = area.data.id;
  const { createServerClient } = await import("@/lib/supabase/server");
  vi.mocked(createServerClient).mockResolvedValue(db);
  vi.mocked(getHotelScope).mockResolvedValue({ supabase: db, hotels: [hotel.data], selectedHotelId: hotelId, areaId, enabledSources: ["claude"] } as Awaited<ReturnType<typeof getHotelScope>>);
});
afterAll(async () => {
  if (enabled) {
    await db.from("accounts").delete().eq("id", accountId);
    if (eventId) await db.from("events").delete().eq("id", eventId);
    if (previousEventId) await db.from("events").delete().eq("id", previousEventId);
  }
  vi.unstubAllEnvs();
});

it.skipIf(!enabled || live)("persists recorded DDW evidence and uses it after reload in the real calendar and workbook paths", async () => {
  const page = pages.results.find((entry) => entry.requestedUrl.includes("over-ddw"))!.page!;
  const locationText = page.text.split("\n").find((line) => line.includes("120 locaties"))!;
  const audienceText = page.text.split("\n").find((line) => line.includes("300.000"))!;
  const hostCityText = page.text.split("\n").find((line) => line.includes("barst Eindhoven"))!;
  const evidence = verifyEventEvidence({ dateText: "2027\n23-31 Oktober", locationText, hostCityText, hostCity: "Eindhoven", locationScope: "citywide", continuous: true, majorCompetition: false,
    demand: [{ sourceUrl: page.url, text: audienceText, scope: "series", year: null, comparable: true, applicability: "Official ongoing series in the same host city and citywide format." }] }, page.url, [page], pages.capturedAt);
  expect(evidence?.demand).toHaveLength(1);
  // Explicitly synthetic interpretation of recorded page text; no claim of live model coverage.
  const candidate: EventCandidate = { provider: "claude", providerEventId: `replay-${accountId}`, sourceUrl: page.url, title: `Dutch Design Week replay ${accountId}`, category: "culture", venue: null, latitude: 51.44, longitude: 5.48, regionScope: "Eindhoven", startAt: localDateBoundary("2027-10-23"), endAt: localDateBoundary("2027-10-31", true), sourceState: "active", certainty: "confirmed", localRank: null, attendance: null, venueCapacity: null, aiImpactPoints: 60, overnightAudience: "international", evidenceText: audienceText, primarySourceConfirmed: true, evidence };
  const repository = createCollectionRepository();
  const previous: EventCandidate = { ...candidate, providerEventId: `previous-${accountId}`, venue: "Diverse locaties in Eindhoven", startAt: localDateBoundary("2026-10-17"), endAt: localDateBoundary("2026-10-25", true), evidence: verifyEventEvidence({ ...evidence!, dateText: "2026\n17-25 Oktober" }, page.url, [page], pages.capturedAt) };
  previousEventId = (await repository.persistCandidate(await repository.loadContext(accountId, areaId), previous)).eventId;
  expect(previousEventId).toBeTruthy();
  const context = await repository.loadContext(accountId, areaId);
  expect(context.longRangeSeeds).toEqual([expect.objectContaining({ lastEditionStart: "2026-10-17", lastEditionEnd: "2026-10-25", officialPages: [page.url], previousLocation: expect.objectContaining({ venue: "Diverse locaties in Eindhoven" }) })]);
  let marketState: LongRangeState = { version: 2003, discoveredAt: pages.capturedAt, announcementSearchAt: pages.capturedAt, lastSweepAt: pages.capturedAt, leads: [] };
  const modelEvent = { ...candidate, startAt: "2027-10-23", endAt: "2027-10-31", latitude: null, longitude: null, status: "active", ownerType: "organizer", titleConfirmed: true, dateConfirmed: true, locationConfirmed: true, impactPoints: 60, facts: evidence };
  const collector = async () => collectLongRange({ start: "2026-12-07", end: "2027-12-31", location: "Eindhoven", radiusKm: 25, seeds: context.longRangeSeeds, now: new Date(pages.capturedAt), model: "claude-sonnet-5", batching: { enabled: false },
    store: { acquire: async () => true, release: async () => {}, load: async () => structuredClone(marketState), save: async (_key, value) => { marketState = structuredClone(value); } },
    pageFetcher: async (url) => { if (url !== page.url) throw new Error("Unrecorded URL: network disabled"); return page; },
    geocodeCity: async (city) => recordedCity(city, async () => new Response(JSON.stringify(locations.results.find((result) => result.city === city)!.body))),
    client: { messages: { create: async () => ({ id: `offline-${accountId}`, stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 }, content: [{ type: "text", text: JSON.stringify({ events: [modelEvent], more: false, reason: "Synthetic interpretation of recorded body" }) }] }) } } as unknown as Anthropic,
  });
  await runCollection({ accountId, areaId, trigger: "manual" }, { repository, collectors: { claude: collector } });
  const source = await db.from("event_sources").select("event_id, evidence, attendance").eq("provider_event_id", marketState.leads[0].editions[0].providerEventId).single();
  if (source.error) throw source.error;
  eventId = source.data.event_id;
  expect(source.data.attendance).toBeNull();
  expect(source.data.evidence).toMatchObject({ hostCity: "Eindhoven", demand: [{ scope: "series" }] });
  const eligibility = await db.from("hotel_event_scores").select("first_eligible_at").eq("hotel_id", hotelId).eq("event_id", eventId).single();
  expect(eligibility.data?.first_eligible_at).toBeTruthy();
  const freshRepository = createCollectionRepository();
  await freshRepository.recalculateScores(await freshRepository.loadContext(accountId, areaId));
  expect((await db.from("hotel_event_scores").select("first_eligible_at").eq("hotel_id", hotelId).eq("event_id", eventId).single()).data?.first_eligible_at).toBe(eligibility.data?.first_eligible_at);
  const calendar = await getCalendarData(accountId, { month: "2027-10" });
  expect(calendar.events.map((event) => event.id)).toContain(eventId);
  expect(calendar.events.find((event) => event.id === eventId)?.locationApproximate).toBe(true);
  const exported = await loadExportEvents(accountId, { start: "2027-01-01", end: "2027-12-31" }, [hotelId]);
  const rows = mapRevControlRows(exported.events, [hotelId]);
  expect(rows).toHaveLength(1);
  expect(rows[0].startDate.toISOString().slice(0, 10)).toBe("2027-10-23");
  expect(rows[0].endDate.toISOString().slice(0, 10)).toBe("2027-10-31");
  expect((await buildRevControlWorkbook(rows)).byteLength).toBeGreaterThan(1000);
  await db.from("hotels").update({ enabled_sources: [] }).eq("id", hotelId);
  vi.mocked(getHotelScope).mockResolvedValue({ ...(await getHotelScope(accountId)), enabledSources: [] });
  expect((await getCalendarData(accountId, { month: "2027-10" })).events).toEqual([]);
  expect(mapRevControlRows((await loadExportEvents(accountId, { start: "2027-01-01", end: "2027-12-31" }, [hotelId])).events, [hotelId])).toEqual([]);
}, 30_000);

// Invoked only by the bounded runner after real discovery; no model replies are synthesised here.
it.skipIf(!enabled || !live)("measures isolated live results through persistence, calendar queries and workbook generation", async () => {
  const { count, error } = await db.from("events").select("id", { count: "exact", head: true });
  if (error) throw error;
  if (count) throw new Error("Live evaluation requires an empty isolated event database");
  try {
    const summary = await runCollection({ accountId, areaId, trigger: "manual" }, { repository: createCollectionRepository(), collectors: { claude: async () => live!.result } });
    await createCollectionRepository().recalculateScores(await createCollectionRepository().loadContext(accountId, areaId));
    const calendar = (await Promise.all(Array.from({ length: 12 }, (_, month) => getCalendarData(accountId, { month: `2027-${String(month + 1).padStart(2, "0")}` })))).flatMap((month) => month.events);
    const exported = await loadExportEvents(accountId, { start: "2027-01-01", end: "2027-12-31" }, [hotelId]);
    const rows = mapRevControlRows(exported.events, [hotelId]);
    writeFileSync(`${live!.output}-workbook.xlsx`, Buffer.from(await buildRevControlWorkbook(rows)));
    writeFileSync(`${live!.output}-publication.json`, JSON.stringify({ summary, calendar: [...new Map(calendar.map((event) => [event.id, event])).values()], exported: exported.events, rows }, null, 2));
  } finally {
    // The emptiness check above guarantees these are evaluation-owned events.
    const events = await db.from("events").select("id");
    if (events.error) throw events.error;
    for (const event of events.data) await db.from("events").delete().eq("id", event.id);
  }
}, 60000);

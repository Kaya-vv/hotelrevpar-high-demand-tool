import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { EventCandidate } from "../events/types";
import { createServerClient } from "@/lib/supabase/server";
import { createCollectionRepository } from "./repository";
import { unresolvedEventLocations } from "./unresolved-locations";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }));

const enabled = Boolean(process.env.RESEARCH_LOCAL_KEY);
const accountId = randomUUID();
const hotelId = randomUUID();
let areaId: string;
const db = createClient<Database>("http://127.0.0.1:54421", process.env.RESEARCH_LOCAL_KEY ?? "disabled", { auth: { persistSession: false } });

// Resort Bad Boekelo's real geometry: a 50 km search around Enschede.
const context = () => ({
  area: { id: areaId, accountId, name: "Enschede", searchLocation: "Enschede",
    latitude: 52.1946038542334, longitude: 6.7813574062599, radiusKm: 50, enabledSources: ["claude" as const] },
  hotels: [{ id: hotelId, latitude: 52.1946038542334, longitude: 6.7813574062599, demandRadiusKm: 50, holidayRegion: "north" }],
  window: { start: "2026-09-10", end: "2026-12-09" },
  knownClaudeUrls: [],
  knownEvents: [],
});

const candidate: EventCandidate = {
  provider: "claude",
  providerEventId: "claude:parked-military",
  sourceUrl: "https://www.military-boekelo.nl/overnachten",
  title: "Military Boekelo",
  category: "sports",
  venue: "Military-terrein",
  latitude: null,
  longitude: null,
  regionScope: "Enschede",
  // An all-day placeholder: `eventLocalDate` must read this back as 4 October, not 5 October.
  startAt: "2026-10-01T00:00:00+02:00",
  endAt: "2026-10-04T23:59:59+00:00",
  sourceState: "active",
  certainty: "confirmed",
  localRank: null,
  attendance: null,
  venueCapacity: null,
  aiImpactPoints: null,
  overnightAudience: "international",
  evidenceText: null,
  primarySourceConfirmed: true,
  evidence: {
    dateText: "1 t/m 4 oktober 2026",
    locationText: "  ",
    hostCity: "Enschede",
    hostCityText: null,
    venueAddress: null,
    locationSourceUrl: null,
    identityText: null,
    announcedAt: null,
    announcementText: null,
    announcementSourceUrl: null,
    aliases: [],
    locationScope: "venue",
    continuous: true,
    majorCompetition: true,
    dateSourceUrl: "https://www.military-boekelo.nl/overnachten",
    assessmentVersion: 1,
    checkedAt: "2026-09-14T12:00:00.000Z",
    demand: [],
  },
};

beforeAll(async () => {
  if (!enabled) return;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54421");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", process.env.RESEARCH_LOCAL_KEY!);
  const account = await db.from("accounts").insert({ id: accountId, name: `Parked locations ${accountId}` });
  if (account.error) throw account.error;
  const hotel = await db.from("hotels").insert({ id: hotelId, account_id: accountId, name: "Resort Bad Boekelo",
    latitude: 52.1946038542334, longitude: 6.7813574062599, demand_radius_km: 50, search_location: "Enschede",
    revcontrol_code: `PARK-${hotelId.slice(0, 6)}`, enabled_sources: ["claude"] });
  if (hotel.error) throw hotel.error;
  const area = await db.from("collection_areas").select("id").eq("hotel_id", hotelId).single();
  if (area.error) throw area.error;
  areaId = area.data.id;
  vi.mocked(createServerClient).mockResolvedValue(db);
});

afterAll(async () => {
  if (enabled) await db.from("accounts").delete().eq("id", accountId);
  vi.unstubAllEnvs();
});

it.skipIf(!enabled)("queues an unplaceable event for an address and never re-opens a handled one", async () => {
  const repository = createCollectionRepository();
  await repository.recordUnresolvedLocations(context(), [candidate], "near_term");
  // An identity-less candidate cannot be addressed later, so it must not create a row.
  await repository.recordUnresolvedLocations(context(), [{ ...candidate, providerEventId: "" }], "near_term");

  const queued = await unresolvedEventLocations(accountId);
  expect(queued).toMatchObject([{
    areaId,
    // The collection area is created by a trigger and carries the hotel's own name.
    areaName: "Resort Bad Boekelo",
    provider: "claude",
    providerEventId: candidate.providerEventId,
    horizon: "near_term",
    title: "Military Boekelo",
    venue: "Military-terrein",
    startDate: "2026-10-01",
    endDate: "2026-10-04",
    sourceUrl: "https://www.military-boekelo.nl/overnachten",
    hostCity: "Enschede",
    // A whitespace-only passage is no passage: the operator must not be shown an empty quote.
    locationText: null,
  }]);

  const published = await db.from("unresolved_event_locations")
    .update({ resolved_at: new Date().toISOString(), resolution: "published" })
    .eq("collection_area_id", areaId).eq("provider", "claude")
    .eq("provider_event_id", candidate.providerEventId);
  expect(published.error).toBeNull();

  // The next run rediscovers the same event under a slightly different name. It must refresh the
  // stored record without putting the handled row back in front of an operator.
  await repository.recordUnresolvedLocations(context(), [{ ...candidate, title: "Military Boekelo 2026" }], "long_range");
  expect(await unresolvedEventLocations(accountId)).toEqual([]);
  const stored = await db.from("unresolved_event_locations")
    .select("title, horizon, resolution").eq("collection_area_id", areaId).single();
  expect(stored.data).toEqual({ title: "Military Boekelo 2026", horizon: "long_range", resolution: "published" });
});

it.skipIf(!enabled)("hides parked events from accounts that do not own them", async () => {
  const anon = createClient<Database>("http://127.0.0.1:54421",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
    { auth: { persistSession: false } });
  const { data, error } = await anon.from("unresolved_event_locations").select("title");
  expect(error).toBeNull();
  expect(data).toEqual([]);
});

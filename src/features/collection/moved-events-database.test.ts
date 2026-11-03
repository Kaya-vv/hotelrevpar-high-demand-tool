import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { localDateBoundary } from "../events/evidence";
import type { EventCandidate } from "../events/types";
import { createCollectionRepository } from "./repository";
import { runCollection } from "./run";
import { claudeProviderEventId } from "./sources/claude";

vi.mock("server-only", () => ({}));

const enabled = Boolean(process.env.RESEARCH_LOCAL_KEY);
const accountId = randomUUID();
const hotelId = randomUUID();
const eventIds = new Set<string>();
let areaId: string;
const db = createClient<Database>("http://127.0.0.1:54421", process.env.RESEARCH_LOCAL_KEY ?? "disabled", { auth: { persistSession: false } });

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const sourceUrl = `https://moved-${accountId}.example/festival`;
const edition = (start: string, end: string): EventCandidate => {
  const candidate: EventCandidate = {
    provider: "claude", providerEventId: "", sourceUrl, title: `Moved Festival ${accountId}`, category: "festival",
    venue: "Strijp-S", latitude: 51.4485, longitude: 5.4573, regionScope: "Eindhoven",
    startAt: localDateBoundary(start), endAt: localDateBoundary(end, true), sourceState: "active", certainty: "confirmed",
    localRank: null, attendance: null, venueCapacity: null, aiImpactPoints: 45, overnightAudience: "national", evidenceText: null,
    primarySourceConfirmed: true,
    evidence: { dateText: `${start} t/m ${end}`, locationText: "Strijp-S, Eindhoven", hostCity: "Eindhoven", hostCityText: null,
      venueAddress: null, locationSourceUrl: null, identityText: null, announcedAt: null, announcementText: null, announcementSourceUrl: null,
      aliases: [], locationScope: "venue", continuous: true, majorCompetition: false, dateSourceUrl: sourceUrl, assessmentVersion: 1,
      checkedAt: new Date().toISOString(), demand: [] },
  };
  candidate.providerEventId = claudeProviderEventId(candidate);
  return candidate;
};

beforeAll(async () => {
  if (!enabled) return;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54421");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", process.env.RESEARCH_LOCAL_KEY!);
  const account = await db.from("accounts").insert({ id: accountId, name: `Moved events ${accountId}` });
  if (account.error) throw account.error;
  const hotel = await db.from("hotels").insert({ id: hotelId, account_id: accountId, name: "Moved event hotel",
    latitude: 51.4416, longitude: 5.4697, demand_radius_km: 25, search_location: "Eindhoven",
    revcontrol_code: `MOVE-${hotelId.slice(0, 6)}`, enabled_sources: ["claude"] });
  if (hotel.error) throw hotel.error;
  const area = await db.from("collection_areas").select("id").eq("hotel_id", hotelId).single();
  if (area.error) throw area.error;
  areaId = area.data.id;
});

afterAll(async () => {
  if (enabled) {
    await db.from("accounts").delete().eq("id", accountId);
    if (eventIds.size) await db.from("events").delete().in("id", [...eventIds]);
  }
  vi.unstubAllEnvs();
});

// RevControl imports events by their ID. A postponed event that came back under a new ID would
// sit in their system twice: once on the cancelled date, once on the new one.
it.skipIf(!enabled)("keeps an event's ID when its page moves it to a new date", async () => {
  const repository = createCollectionRepository();
  const collect = (candidate: EventCandidate) => runCollection({ accountId, areaId, trigger: "manual" }, { repository, collectors: {
    claude: async () => ({ source: "claude", candidates: [candidate], requests: 1, usage: {}, refreshedUrls: [sourceUrl] }),
  } });
  const original = edition(day(30), day(31));
  await collect(original);
  const first = (await db.from("event_sources").select("event_id").eq("provider_event_id", original.providerEventId).single()).data!;
  eventIds.add(first.event_id);

  // The organiser's page, re-read a week later, now lists the festival five weeks on.
  const postponed = edition(day(65), day(66));
  expect(postponed.providerEventId).not.toBe(original.providerEventId);
  await collect(postponed);

  const sources = (await db.from("event_sources").select("event_id").eq("source_url", sourceUrl)).data!;
  sources.forEach((source) => eventIds.add(source.event_id));
  expect(sources.map((source) => source.event_id)).toEqual([first.event_id]);
  const event = (await db.from("events").select("start_at").eq("id", first.event_id).single()).data!;
  expect(event.start_at).toBe(new Date(postponed.startAt).toISOString().replace(".000Z", "+00:00"));
  const decision = (await db.from("account_events").select("state").eq("account_id", accountId).eq("event_id", first.event_id).single()).data!;
  expect(decision.state).toBe("active");
}, 60_000);

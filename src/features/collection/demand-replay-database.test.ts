// @vitest-environment node
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import production from "../../../tests/fixtures/hotel-demand-production.json";
import geocodes from "../../../tests/fixtures/hotel-demand-geocodes.json";
import { createLocationResolver, geocodeCity } from "./research-location";
import research from "../../../tests/fixtures/hotel-demand-research.json";
import { createCollectionRepository } from "./repository";
import { getCalendarData } from "../calendar/query";
import { loadExportEvents } from "../export/query";
import { selectScoreEvidence } from "../events/source-evidence";
import { localDateBoundary, readEventEvidence, verifyEventEvidence, type EventEvidence } from "../events/evidence";
import { normalizeCandidate } from "../events/normalize";
import type { EventCandidate } from "../events/types";
import type { Database } from "@/lib/supabase/database.types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }));
vi.mock("../workspace/hotel-context", () => ({ getHotelScope: vi.fn() }));

it.skipIf(!process.env.RESEARCH_LOCAL_KEY)("replays both production markets, enriches missing evidence, persists and checks calendar recall and exclusions", async () => {
  const networkFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== "http://127.0.0.1:54421") throw new Error(`Offline replay blocked ${url.origin}`);
    return networkFetch(input, init);
  });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54421");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", process.env.RESEARCH_LOCAL_KEY!);
  const db = createClient<Database>("http://127.0.0.1:54421", process.env.RESEARCH_LOCAL_KEY!, { auth: { persistSession: false } });
  const checked = <T,>(result: { data: T; error: unknown }) => { if (result.error) throw result.error; return result.data; };
  const reports = [];
  try {
    for (const market of production) {
      const accountId = randomUUID(), hotelId = randomUUID();
      const eventIds: string[] = [];
      const rowIds = new Map<string, string>();
      try {
        checked(await db.from("accounts").insert({ id: accountId, name: `Demand replay ${market.market}` }));
        const hotel = checked(await db.from("hotels").insert({ ...market.hotel, id: hotelId, account_id: accountId, revcontrol_code: "REPLAY", search_location: market.market }).select().single())!;
        const area = checked(await db.from("collection_areas").select("id").eq("hotel_id", hotelId).single())!;
        for (const row of market.rows) {
          const id = randomUUID(); eventIds.push(id); rowIds.set(row.event.id, id);
        }
        checked(await db.from("events").insert(market.rows.map(row => ({ ...row.event, id: rowIds.get(row.event.id)!, normalized_identity: `${accountId}:${row.event.id}` })) as Database["public"]["Tables"]["events"]["Insert"][]));
        checked(await db.from("event_sources").insert(market.rows.flatMap(row => row.sources.map(source => ({ ...source, event_id: rowIds.get(row.event.id)!, provider_event_id: `${accountId}:${source.provider_event_id}` }))) as Database["public"]["Tables"]["event_sources"]["Insert"][]));
        checked(await db.from("account_events").insert(market.rows.map(row => ({ account_id: accountId, event_id: rowIds.get(row.event.id)!, state: row.decision.state ?? "needs_review", review_reason: row.decision.review_reason })) as Database["public"]["Tables"]["account_events"]["Insert"][]));
        checked(await db.from("account_event_areas").insert(eventIds.map(event_id => ({ account_id: accountId, collection_area_id: area.id, event_id }))));
        const { createServerClient } = await import("@/lib/supabase/server");
        const { getHotelScope } = await import("../workspace/hotel-context");
        vi.mocked(createServerClient).mockResolvedValue(db);
        vi.mocked(getHotelScope).mockResolvedValue({ supabase: db, hotels: [hotel], selectedHotelId: hotelId, areaId: area.id, enabledSources: hotel.enabled_sources } as Awaited<ReturnType<typeof getHotelScope>>);
        const repository = createCollectionRepository();
        const context = await repository.loadContext(accountId, area.id);
        const calendar = () => getCalendarData(accountId, { month: "2026-09", view: "list", period: "all" });
        await repository.recalculateScores(context);
        const original = (await calendar()).events.map(event => event.title);
        const enrichedIds = [];
        for (const patch of research.cases.filter(item => item.market === market.market)) {
          const row = market.rows.find(row => row.event.title.toLowerCase().includes(patch.match.toLowerCase()));
          const source = row ? selectScoreEvidence(row.sources as unknown as Database["public"]["Tables"]["event_sources"]["Row"][], hotel.enabled_sources) : undefined;
          const previous = readEventEvidence(source?.evidence);
          const startAt = localDateBoundary(patch.start!), endAt = localDateBoundary(patch.end!, true);
          // Reviewer-confirmed dates/locations are explicit enrichments, not replayed model discoveries.
          const event = row?.event;
          const sourceUrl = patch.dateSourceUrl ?? source?.public_source_url ?? patch.sourceUrl;
          const city = market.market === "utrecht" ? "Utrecht" : "Eindhoven";
          const facts: EventEvidence = { dateText: patch.dateQuote,
            locationText: (patch.locationQuote ?? previous?.locationText) || city,
            hostCityText: city,
            hostCity: market.market === "utrecht" ? "Utrecht" : "Eindhoven", locationScope: previous?.locationScope === "citywide" ? "citywide" : "venue",
            continuous: patch.start !== patch.end, majorCompetition: patch.kind === "national_competition",
            dateSourceUrl: sourceUrl, checkedAt: new Date().toISOString(),
            demand: [{ kind: patch.kind as EventEvidence["demand"][number]["kind"], text: patch.quote,
              scope: patch.scope as "edition" | "historical" | "series", year: patch.year, comparable: true,
              applicability: patch.note, sourceUrl: patch.sourceUrl }] };
          // Check demand quotes independently; date metadata above is labelled reviewer input.
          const verified = verifyEventEvidence(facts, sourceUrl, [{ url: patch.sourceUrl, text: patch.quote }], research.reviewedAt);
          expect(verified?.demand, patch.match).toHaveLength(1);
          const candidate: EventCandidate = { provider: "claude", providerEventId: `${accountId}:research:${patch.match}`, sourceUrl,
            publicSourceUrl: sourceUrl, title: event?.title ?? patch.title ?? patch.match, category: event?.category ?? (patch.kind === "trade_fair" ? "trade_fair" : "conference"),
            venue: event?.venue ?? patch.venue ?? null, latitude: null, longitude: null,
            regionScope: null, startAt, endAt, sourceState: "active", certainty: "confirmed", localRank: null, attendance: null,
            venueCapacity: null, evidenceText: patch.note, primarySourceConfirmed: true, evidence: { ...facts, demand: verified!.demand } };
          await createLocationResolver({ venue: async () => null, city: async (name) => geocodeCity(name, async () => new Response(JSON.stringify({ response: { docs: geocodes[name as keyof typeof geocodes] } }))) })(candidate);
          expect(candidate.evidence?.locationResolution?.method).toBe("city_centroid");
          if (row) {
            // Reassess the same saved edition, preserve its account decision except the explicitly reviewed WoTS date failure.
            const id = rowIds.get(row.event.id)!;
            checked(await db.from("events").update({ start_at: startAt, end_at: endAt }).eq("id", id));
            if (patch.match === "(WoTS)") checked(await db.from("account_events").update({ state: "active", review_reason: null }).eq("account_id", accountId).eq("event_id", id));
            candidate.providerEventId = `${accountId}:${source?.provider_event_id ?? patch.match}`;
            candidate.provider = (source?.provider ?? "claude") as EventCandidate["provider"];
          }
          const result = await repository.persistCandidate(context, normalizeCandidate(candidate));
          expect(result.state, patch.match).toBe("active");
          if (result.eventId && !eventIds.includes(result.eventId)) eventIds.push(result.eventId);
          enrichedIds.push({ title: candidate.title, id: result.eventId, note: patch.note });
        }
        await repository.recalculateScores(context);
        const visible = (await calendar()).events;
        for (const item of enrichedIds) expect(visible.some(event => event.id === item.id), item.title).toBe(true);
        const controls = market.rows.filter(row => /Candlelight|Radio Party|Master Open Day|Bachelor Open Day|Titanique|Lichtjesroute|Otten Innovation|Lucinda|Dragons/i.test(row.event.title));
        for (const row of controls) expect(visible.some(event => event.id === rowIds.get(row.event.id)), row.event.title).toBe(false);
        const exports = await loadExportEvents(accountId, { start: "2026-09-09", end: "2027-12-31" }, [hotelId]);
        for (const event of exports.events) for (const scope of event.hotels) {
          if (scope.announced) expect(scope.exportLevel).toBeNull();
        }
        reports.push({ market: market.market, capturedAt: market.capturedAt, originalEvidenceVisible: original, researchedPositiveCount: enrichedIds.length,
          positiveRecall: enrichedIds.filter(item => visible.some(event => event.id === item.id)).length,
          controlsChecked: controls.length, controlsVisible: 0, visible: visible.map(event => ({ title: event.title, startAt: event.startAt, assessment: event.demandAssessment })), additionalProviderSpend: 0 });
      } finally {
        checked(await db.from("accounts").delete().eq("id", accountId));
        checked(await db.from("events").delete().in("id", eventIds));
      }
    }
    mkdirSync("refs/scoring-review", { recursive: true });
    writeFileSync("refs/scoring-review/database-replay.json", JSON.stringify(reports, null, 2));
  } finally { vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
}, 180_000);

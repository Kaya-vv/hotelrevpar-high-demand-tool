import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import fixture from "../../../tests/fixtures/the-match-repair.json";
import recording from "../../../tests/fixtures/the-match-repair-page.json";
import { createCollectionRepository } from "./repository";
import { collectLongRange } from "./sources/long-range";
import { publishLongRangeResult, runCollection } from "./run";
import { storedLongRangeResult } from "./market-research";
import type { LongRangeState } from "./long-range-store";
import { createLongRangeStore, longRangeMarketKey } from "./long-range-store";
import { processCollectionJob } from "./jobs";
import type { SourceResult } from "./types";
import { getCalendarData } from "../calendar/query";
import { getHotelScope } from "../workspace/hotel-context";
import { loadExportEvents } from "../export/query";
import { mapRevControlRows } from "../export/map-rows";
import { buildRevControlWorkbook } from "../export/build-workbook";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }));
vi.mock("../workspace/hotel-context", () => ({ getHotelScope: vi.fn() }));

it.skipIf(!process.env.RESEARCH_LOCAL_KEY)("repairs the retained DDW edition and adds exactly one calendar entry while preserving the starting calendar", async () => {
  const networkFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== "http://127.0.0.1:54421") throw new Error(`External network disabled during publication replay: ${url.origin}`);
    return networkFetch(input, init);
  });
  const db = createClient<Database>("http://127.0.0.1:54421", process.env.RESEARCH_LOCAL_KEY!, { auth: { persistSession: false } });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54421");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", process.env.RESEARCH_LOCAL_KEY!);
  const accountId = randomUUID(), hotelId = randomUUID();
  const baselineIds = fixture.baseline.events.map((event) => event.id);
  const visibleIds = fixture.baseline.visibleIds;
  let createdId: string | undefined;
  let previousMarket: LongRangeState | null | undefined;
  const marketKey = longRangeMarketKey("Eindhoven", fixture.hotel.radiusKm);
  const checked = <T,>(result: { data: T; error: unknown }) => { if (result.error) throw result.error; return result.data; };
  try {
    checked(await db.from("accounts").insert({ id: accountId, name: "The Match outcome evaluation" }));
    const hotel = checked(await db.from("hotels").insert({ id: hotelId, account_id: accountId, name: "The Match", latitude: fixture.hotel.latitude, longitude: fixture.hotel.longitude, demand_radius_km: fixture.hotel.radiusKm, search_location: "Eindhoven", enabled_sources: fixture.hotel.enabledSources, revcontrol_code: "TEST" }).select().single())!;
    const area = checked(await db.from("collection_areas").select("id").eq("hotel_id", hotelId).single())!;
    checked(await db.from("events").insert(fixture.baseline.events as Database["public"]["Tables"]["events"]["Insert"][]));
    checked(await db.from("event_sources").insert(fixture.baseline.sources as Database["public"]["Tables"]["event_sources"]["Insert"][]));
    checked(await db.from("account_events").insert(fixture.baseline.decisions.map((decision) => ({ ...decision, account_id: accountId })) as Database["public"]["Tables"]["account_events"]["Insert"][]));
    checked(await db.from("account_event_areas").insert(baselineIds.map((event_id) => ({ account_id: accountId, collection_area_id: area.id, event_id }))));
    checked(await db.from("hotel_event_scores").insert(fixture.baseline.scores.map((score) => ({ ...score, hotel_id: hotelId }))));
    const { createServerClient } = await import("@/lib/supabase/server");
    vi.mocked(createServerClient).mockResolvedValue(db);
    vi.mocked(getHotelScope).mockResolvedValue({ supabase: db, hotels: [hotel], selectedHotelId: hotelId, areaId: area.id, enabledSources: fixture.hotel.enabledSources } as Awaited<ReturnType<typeof getHotelScope>>);
    const calendar = async () => [...new Map((await Promise.all(Array.from({ length: 12 }, (_, month) => getCalendarData(accountId, { month: `2027-${String(month + 1).padStart(2, "0")}` })))).flatMap((result) => result.events).map((event) => [event.id, event])).values()];
    expect((await calendar()).map((event) => event.id).sort()).toEqual([...visibleIds].sort());
    const repository = createCollectionRepository();
    const context = await repository.loadContext(accountId, area.id);
    let startingVisibleIds = [...visibleIds];
    if (process.env.RESEARCH_PRODUCTION_REPLAY) {
      // Reproduce the last production output first, including the already-observed
      // Playgrounds downgrade. This repair must preserve that starting calendar.
      const before = JSON.parse(readFileSync("refs/research-evaluation/fast-repair/production-latest.json", "utf8")).market.state as LongRangeState;
      await publishLongRangeResult(repository, context, storedLongRangeResult(before));
      startingVisibleIds = (await calendar()).map((event) => event.id);
      expect(startingVisibleIds).toHaveLength(2);
      expect((await calendar()).some((event) => /Dutch Design Week/i.test(event.title))).toBe(false);
    }
    let state: LongRangeState = { version: 2003, discoveredAt: fixture.capturedAt, announcementSearchAt: fixture.capturedAt, leads: [structuredClone(fixture.lead) as LongRangeState["leads"][number]] };
    // Refresh completes with the old market record, while research is still pending.
    const refresh = await runCollection({ accountId, areaId: area.id, trigger: "manual" }, { repository, collectors: { ...Object.fromEntries(context.area.enabledSources.map((source) => [source, async () => ({ source, candidates: [], requests: 0, usage: {} })])), claude: async () => ({ ...storedLongRangeResult(state), researchPending: true }) } });
    expect(refresh.status).toBe("completed");
    expect(refresh.sourceResults.claude).toMatchObject({ researchPending: true });
    expect(checked(await db.from("collection_runs").select("finished_at").eq("id", refresh.runId).single())!.finished_at).toBeTruthy();
    expect((await getCalendarData(accountId, { month: "2027-10" })).latestRun?.researchPending).toBe(true);
    const live = process.env.RESEARCH_REPAIR_RESULT;
    let result: SourceResult;
    if (live) result = JSON.parse(readFileSync(live, "utf8"));
    else {
      const page = recording.page;
      const audience = page.text.split("\n").find((line) => line.includes("300,000"))!;
      const city = page.text.split("\n").find((line) => line.includes("Eindhoven is bursting"))!;
      const response = { ...fixture.lead.editions[0], startAt: "2027-10-23", endAt: "2027-10-31", status: "active", ownerType: "organizer", titleConfirmed: true, dateConfirmed: true, locationConfirmed: true, impactPoints: 60,
        facts: { dateText: "2027\n23-31 October", locationText: audience, hostCityText: city, hostCity: "Eindhoven", locationScope: "citywide", continuous: true, majorCompetition: false, demand: [{ sourceUrl: page.url, text: audience, scope: "series", year: null, comparable: true, applicability: "Same ongoing citywide design event in Eindhoven." }] } };
      const create = vi.fn(async () => ({ id: `offline-${accountId}`, stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 }, content: [{ type: "text", text: JSON.stringify({ events: [response], more: false, reason: "Synthetic interpretation of actual recorded page body" }) }] }));
      result = await collectLongRange({ start: "2026-12-07", end: "2027-12-31", now: new Date(fixture.capturedAt), location: "Eindhoven", radiusKm: fixture.hotel.radiusKm, model: "claude-sonnet-5", batching: { enabled: false },
        store: { acquire: async () => true, release: async () => {}, load: async () => structuredClone(state), save: async (_key, next) => { state = structuredClone(next); } },
        pageFetcher: async (url) => { if (url !== recording.requestedUrl) throw new Error("Unrecorded page: network disabled"); return page; },
        geocodeCity: async () => ({ latitude: 51.44, longitude: 5.48 }), client: { messages: { create } } as unknown as Anthropic,
      });
      expect(create).toHaveBeenCalledTimes(1);
      expect(state.leads[0].repair?.attemptedAt).toBeTruthy();
      expect(result.candidates[0].providerEventId).toBe(fixture.lead.editions[0].providerEventId);
      expect(state.leads[0].outcome).not.toBe("conflict");
    }
    const marketStore = createLongRangeStore();
    expect(await marketStore.acquire(marketKey)).toBe(true);
    previousMarket = await marketStore.load(marketKey);
    state.leads = [{ ...state.leads[0], editions: [...result.candidates, { ...result.candidates[0], title: "Invalid retained range", providerEventId: "invalid-range", startAt: "2027-04-11T22:00:00Z", endAt: "2027-04-11T21:59:59Z" }], outcome: "confirmed" }];
    state.publicationPending = true;
    state.research = { requestedAt: new Date().toISOString() };
    await marketStore.save(marketKey, state);
    await marketStore.release(marketKey);
    const work = { kind: "market-publication" as const, accountId, areaId: area.id, runId: refresh.runId, requestedAt: new Date().toISOString() };
    await processCollectionJob(work, 1);
    expect((await marketStore.load(marketKey))?.publicationPending).toBe(false);
    expect((await marketStore.load(marketKey))?.publishedAt).toBeTruthy();
    expect((await marketStore.load(marketKey))?.research?.usage?.announcementDateUnknown).toBeGreaterThan(0);
    expect((await getCalendarData(accountId, { month: "2027-10" })).latestRun?.researchPending).toBe(false);
    // Publication retries reuse persisted evidence and do not start a collector.
    await publishLongRangeResult(createCollectionRepository(), await repository.loadContext(accountId, area.id), result);
    const visible = await calendar();
    const added = visible.filter((event) => !baselineIds.includes(event.id));
    createdId = added[0]?.id;
    if (visible.length !== startingVisibleIds.length + 1) writeFileSync("refs/research-evaluation/outcome-failure.json", JSON.stringify({ visible, result, scores: checked(await db.from("hotel_event_scores").select("*").eq("hotel_id", hotelId)), context }, null, 2));
    expect(visible).toHaveLength(startingVisibleIds.length + 1);
    expect(added).toHaveLength(1);
    expect(visible.filter((event) => startingVisibleIds.includes(event.id)).map((event) => event.id).sort()).toEqual([...startingVisibleIds].sort());
    expect(added[0].title).toMatch(/Dutch Design Week/i);
    const exported = await loadExportEvents(accountId, { start: "2027-01-01", end: "2027-12-31" }, [hotelId]);
    const rows = mapRevControlRows(exported.events, [hotelId]);
    expect(rows).toHaveLength(startingVisibleIds.length + 1);
    const ddw = rows.find((row) => /Dutch Design Week/i.test(row.event))!;
    expect(ddw.startDate.toISOString().slice(0, 10)).toBe("2027-10-23");
    expect(ddw.endDate.toISOString().slice(0, 10)).toBe("2027-10-31");
    const workbook = await buildRevControlWorkbook(rows);
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(workbook as unknown as Parameters<typeof reopened.xlsx.load>[0]);
    const ddwRow = reopened.worksheets[0].getRow(rows.indexOf(ddw) + 2);
    expect(ddwRow.getCell(2).value).toBe(ddw.event);
    expect((ddwRow.getCell(3).value as Date).toISOString().slice(0, 10)).toBe("2027-10-23");
    expect((ddwRow.getCell(4).value as Date).toISOString().slice(0, 10)).toBe("2027-10-31");
    if (process.env.RESEARCH_REPAIR_OUTPUT) {
      writeFileSync(`${process.env.RESEARCH_REPAIR_OUTPUT}-publication.json`, JSON.stringify({ visible, rows, refresh, baselineIds, startingVisibleIds }, null, 2));
      writeFileSync(`${process.env.RESEARCH_REPAIR_OUTPUT}-workbook.xlsx`, Buffer.from(workbook));
    }
    checked(await db.from("account_events").update({ state: "excluded", operator_note: "Preserve account decision" }).eq("account_id", accountId).eq("event_id", createdId!));
    await publishLongRangeResult(repository, context, result);
    expect(checked(await db.from("account_events").select("state, operator_note").eq("account_id", accountId).eq("event_id", createdId!).single())).toMatchObject({ state: "excluded", operator_note: "Preserve account decision" });
    await publishLongRangeResult(repository, { ...context, area: { ...context.area, enabledSources: [] } }, { ...result, candidates: result.candidates.map((event) => ({ ...event, title: "Must not publish" })) });
    expect(checked(await db.from("events").select("title").eq("id", createdId!).single())!.title).toMatch(/Dutch Design Week/i);
    const candidate = result.candidates.find((event) => /Dutch Design Week/i.test(event.title))!;
    const latestEvidence = { ...candidate.evidence!, checkedAt: new Date(Date.parse(candidate.evidence!.checkedAt) + 60_000).toISOString() };
    await repository.persistCandidate(context, { ...candidate, sourceState: "cancelled", evidence: latestEvidence });
    await publishLongRangeResult(repository, context, result);
    const preserved = checked(await db.from("event_sources").select("source_state, evidence").eq("provider", "claude").eq("provider_event_id", candidate.providerEventId).single())!;
    expect(preserved.source_state).toBe("cancelled");
    expect(preserved.evidence).toMatchObject({ checkedAt: latestEvidence.checkedAt });
  } finally {
    if (previousMarket !== undefined) {
      if (previousMarket) {
        const store = createLongRangeStore();
        if (await store.acquire(marketKey)) { await store.save(marketKey, previousMarket); await store.release(marketKey); }
      } else await db.from("long_range_markets").delete().eq("market_key", marketKey);
    }
    await db.from("accounts").delete().eq("id", accountId);
    await db.from("events").delete().in("id", [...baselineIds, ...(createdId ? [createdId] : [])]);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }
}, 60_000);

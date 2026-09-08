import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { collectLongRange, selectDueLeads } from "./sources/long-range";
import { collectClaudeCalendar, parseDiscovery } from "./sources/claude";
import { parseOfficialPage } from "./official-pages";
import { geocodeCity, createLocationResolver } from "./research-location";
import { researchBudget } from "./research-budget";
import { localDateBoundary, verifyEventEvidence, supportedAudience } from "../events/evidence";
import { localParts, eventLocalDate } from "../events/normalize";
import { scoreHotelEvent } from "../events/score";
import { mapRevControlRows } from "../export/map-rows";
import type { Lead, LongRangeState, LongRangeStore } from "./long-range-store";
import { BatchPendingError, type BatchStore } from "./anthropic-batches";
import productionDdw from "../../../tests/fixtures/production-ddw-extraction.json";
import { eventFactsSchema, uniqueEvidenceEditions } from "../events/evidence";
import { storedLongRangeResult } from "./market-research";

const now = new Date("2026-09-07T12:00:00Z");
const url = "https://organizer.example/about";
const text = "Arts Week takes place 23-31 October 2027. Across the city of Eindhoven. Visitors travel from across the Netherlands and stay in local hotels.";
const facts = { dateText: "Arts Week takes place 23-31 October 2027.", locationText: "Across the city of Eindhoven.", hostCity: "Eindhoven", locationScope: "citywide" as const, continuous: true, majorCompetition: false,
  demand: [{ sourceUrl: url, text: "Visitors travel from across the Netherlands and stay in local hotels.", scope: "series" as const, year: null, comparable: true, applicability: "Official ongoing series in the same host city and citywide format." }] };
const event = { sourceUrl: url, title: "Arts Week", category: "culture", venue: null, latitude: null, longitude: null, regionScope: "Eindhoven", startAt: "2027-10-23", endAt: "2027-10-31", status: "active", ownerType: "organizer", evidenceText: text, attendance: null, venueCapacity: null, impactPoints: 60, overnightAudience: "national", titleConfirmed: true, dateConfirmed: true, locationConfirmed: true, facts };
const makeLead = (extra: Partial<Lead> = {}): Lead => ({ key: "arts", title: "Arts Week", url, kind: "event", group: 0, nextCheck: now.toISOString(), checkedAt: null, outcome: "pending", editions: [], notes: [], ...extra });
function setup() {
  let state: LongRangeState = { version: 2003, discoveredAt: now.toISOString(), announcementSearchAt: now.toISOString(), lastSweepAt: now.toISOString(), leads: [makeLead()] };
  const store: LongRangeStore = { acquire: async () => true, release: async () => {}, load: async () => structuredClone(state), save: async (_key, next) => { state = structuredClone(next); } };
  const create = vi.fn(async () => ({ id: "message-1", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 100 }, content: [{ type: "text", text: JSON.stringify({ events: [event], reason: "Synthetic model response tests processing, not live model accuracy", more: false }) }] }));
  const pageFetcher = vi.fn(async (requested = url) => parseOfficialPage(text, requested));
  const city = vi.fn(async () => ({ latitude: 51.44, longitude: 5.48 }));
  const input = { start: "2026-12-07", end: "2027-12-31", location: "Eindhoven", radiusKm: 25, now, model: "claude-sonnet-5", batching: { enabled: false }, store, client: { messages: { create } } as unknown as Anthropic, pageFetcher, geocodeCity: city };
  return { input, create, pageFetcher, city, state: () => state };
}

describe("coordinated long-range research", () => {
  it.each([
    ["Amsterdam", "Bruno Mars", "concert"],
    ["Rotterdam", "Medical Congress", "conference"],
    ["Eindhoven", "Design Festival", "festival"],
    ["Utrecht", "University Congress", "university"],
    ["Maastricht", "National Championships", "sport"],
  ])("monitors short-notice and year-ahead editions together in %s (%s)", async (city, title, category) => {
    const test = setup();
    const locationText = `Across the city of ${city}.`;
    const dateText = `${title} takes place 19 October 2026.`;
    const near = { ...event, title, category, regionScope: city, startAt: "2026-10-19", endAt: "2026-10-19", facts: { ...facts, dateText, locationText, hostCity: city, continuous: false } };
    const future = { ...event, regionScope: city, facts: { ...facts, locationText, hostCity: city } };
    test.pageFetcher.mockResolvedValue(parseOfficialPage(`${dateText}\n${facts.dateText}\n${locationText}\n${facts.demand[0].text}`, url));
    test.create.mockImplementation(async (...args: unknown[]) => {
      expect(JSON.stringify(args[0])).toContain("between 2026-09-07 and 2027-12-31");
      return { id: "full-horizon", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 100 }, content: [{ type: "text", text: JSON.stringify({ events: [near, future], reason: "Recorded-page extraction fixture", more: false }) }] };
    });
    const result = await collectLongRange({ ...test.input, location: city });
    expect(result.candidates.map((item) => eventLocalDate(item.startAt)).sort()).toEqual(["2026-10-19", "2027-10-23"]);
    expect(result.candidates.every((item) => item.primarySourceConfirmed)).toBe(true);
    expect(result.usage.monthlySpentEur).toBeLessThanOrEqual(8);
  });

  it("upgrades an old completed extraction without dropping its evidence or billing ledger", async () => {
    const test = setup();
    await collectLongRange(test.input);
    const state = test.state();
    state.cycle!.monitoringVersion = 1;
    state.cycle!.finished = true;
    state.cycle!.queued = [{ leadKey: "arts", kind: "fetch", windowStart: test.input.start, target: url, cached: true, pages: [parseOfficialPage(text, url)] }];
    test.pageFetcher.mockRejectedValue(new Error("Use the retained queued page during the upgrade"));
    for (const entry of Object.values(state.pageCache ?? {})) entry.version = 12027;
    const billed = [...state.budget!.billedIds];
    const confirmed = state.leads[0].editions[0].providerEventId;
    const requests = test.create.mock.calls.length;
    await collectLongRange(test.input);
    expect(test.create.mock.calls.length).toBeGreaterThan(requests);
    expect(test.pageFetcher).toHaveBeenCalledTimes(1);
    expect(test.state().budget!.billedIds).toEqual(expect.arrayContaining(billed));
    expect(test.state().leads[0].editions.some((edition) => edition.providerEventId === confirmed)).toBe(true);
    expect(Object.values(test.state().pageCache ?? {}).every((entry) => entry.version === 22027)).toBe(true);
    const afterUpgrade = test.create.mock.calls.length;
    await collectLongRange(test.input);
    expect(test.create).toHaveBeenCalledTimes(afterUpgrade);
  });
  it("repairs the actual production quotation from a contiguous dated passage, preserving scoped demand", () => {
    const event = productionDdw.event;
    const evidence = verifyEventEvidence(eventFactsSchema.parse(event.facts), event.sourceUrl, [productionDdw.page], productionDdw.checkedAt, event);
    expect(evidence?.dateText).toMatch(/^2027\s+23-31 October$/);
    expect(evidence?.hostCity).toBe("Eindhoven");
    expect(evidence?.locationScope).toBe("citywide");
    expect(evidence?.demand).toHaveLength(1);
    expect(evidence?.demand[0]).toMatchObject({ scope: "series", year: null });
    expect(supportedAudience(evidence, "international")).toBe("international");
  });
  it.each([
    "Upcoming Arts Week 2026 23-31 October\n2027 dates not announced",
    "Upcoming Arts Week 2027\n23 October registration opens\n31 October registration closes",
    "Upcoming Arts Week 2027 24-31 October",
  ])("does not assemble date evidence from unrelated or wrong dates: %s", (body) => {
    const evidence = verifyEventEvidence({ ...facts, dateText: "Upcoming Arts Week 2027 23-31 October" }, url,
      [{ url, text: `${body}\n${facts.locationText}\n${facts.demand[0].text}` }], now.toISOString(), { ...event, ownerType: "organizer" });
    expect(evidence?.dateText).toBe("");
    expect(evidence?.locationText).toBe(facts.locationText);
    expect(evidence?.demand).toHaveLength(1);
  });
  it("keeps invalid date evidence pending extraction and never publishes it", async () => {
    const test = setup();
    test.pageFetcher.mockResolvedValue(parseOfficialPage(`${facts.locationText}\n${facts.demand[0].text}`, url));
    const result = await collectLongRange(test.input);
    expect(result.candidates[0].evidence?.dateText).toBe("");
    expect(result.candidates[0].primarySourceConfirmed).toBe(false);
    expect(test.state().leads[0].pendingStage).toBe("extraction");
    const calls = test.create.mock.calls.length;
    // The unsuccessful extraction is cached, but must retry when its weekly check is due.
    await collectLongRange({ ...test.input, now: new Date("2026-09-14T12:00:00Z") });
    expect(test.create.mock.calls.length).toBeGreaterThan(calls);
  });
  it("keeps repaired evidence across stale duplicate leads, reload and newer cancellation", async () => {
    const test = setup();
    const result = await collectLongRange(test.input);
    const good = result.candidates[0];
    const stale = { ...good, evidence: undefined, latitude: null, longitude: null, primarySourceConfirmed: false };
    test.state().leads.push(makeLead({ editions: [stale] }));
    expect(storedLongRangeResult(JSON.parse(JSON.stringify(test.state())), now).candidates[0]).toEqual(good);
    const cancelled = { ...good, sourceState: "cancelled" as const, evidence: { ...good.evidence!, checkedAt: "2026-09-08T12:00:00Z" } };
    expect(uniqueEvidenceEditions([cancelled, good, stale])).toEqual([cancelled]);
  });
  it("accepts typographic quote variations without accepting changed demand facts", () => {
    const official = "The world’s visitors attend the Arts Week across 120 locations.";
    const quoted = official.replace("’", "'");
    const source = [{ url, text: `${text}\n${official}` }];
    const input = { ...facts, locationText: "Across the city of Eindhoven.", identityText: quoted, demand: [{ ...facts.demand[0], text: quoted }] };
    expect(verifyEventEvidence(input, url, source, now.toISOString())?.demand).toHaveLength(1);
    expect(verifyEventEvidence({ ...input, demand: [{ ...input.demand[0], text: quoted.replace("120", "1200") }] }, url, source, now.toISOString())?.demand).toHaveLength(0);
  });
  it.each(["waiting", "accounting", "application"])("resumes the exact batch after interruption during %s without paying twice or refetching pages", async (stage) => {
    const test = setup();
    let row: Awaited<ReturnType<BatchStore["get"]>> = null;
    let params: { requests: { custom_id: string }[] };
    let ended = stage !== "waiting";
    const deadline = Date.now() + 60_000;
    const clock = vi.spyOn(Date, "now");
    const batchStore: BatchStore = {
      removeExpired: async () => {}, get: async () => row,
      claim: async () => { row = { status: "creating", batch_id: null, results: null, error: null, created_at: new Date().toISOString() }; return true; },
      attach: async (_key, _owner, batchId) => { row = { ...row!, status: "processing", batch_id: batchId }; },
      complete: async (_key, results) => { row = { ...row!, status: "completed", results }; },
      fail: async () => {}, release: async () => {}, claimUsage: vi.fn(async () => { throw new Error("Per-request accounting owns research usage"); }),
    };
    const create = vi.fn(async (input) => { params = input; return { id: "durable-batch" }; });
    const client = { messages: { batches: { create, retrieve: async () => ({ processing_status: ended ? "ended" : "in_progress" }), results: async function* () {
      for (const request of params.requests) yield { custom_id: request.custom_id, result: { type: "succeeded", message: await test.create() } };
    } } } } as unknown as Anthropic;
    let interrupted = false;
    const store = { ...test.input.store, save: async (key: string, state: LongRangeState) => {
      if (stage === "application" && !interrupted && !state.cycle?.pending && state.leads[0].editions.length) { interrupted = true; throw new Error("Application interrupted"); }
      await test.input.store.save(key, state);
    } };
    const usage = new Set<string>();
    const onUsage = async (event: import("./sources/claude").ClaudeUsageEvent) => {
      if (stage === "accounting" && !interrupted) { interrupted = true; throw new Error("Accounting interrupted"); }
      usage.add(event.requestId!);
    };
    try {
      const input = { ...test.input, start: "2027-10-31", client, store, onUsage, batching: { enabled: true, store: batchStore, deadline, wait: async () => { clock.mockReturnValue(deadline + 1); } } };
      await expect(collectLongRange(input)).rejects.toThrow(stage === "waiting" ? BatchPendingError : /interrupted/);
      expect(test.state().cycle?.pending?.jobs).toHaveLength(1);
      delete test.state().cycle!.monitoringVersion; // Simulate an in-flight pre-upgrade manifest.
      ended = true;
      clock.mockRestore();
      test.pageFetcher.mockRejectedValue(new Error("Page must be restored from the manifest"));
      // A delayed response keeps the original request window when the horizon moves forward.
      const result = await collectLongRange({ ...input, start: "2027-11-01" });
      expect(create).toHaveBeenCalledTimes(1);
      expect(test.pageFetcher).toHaveBeenCalledTimes(1);
      expect(result.candidates).toHaveLength(1);
      expect(test.state().cycle?.pending).toBeUndefined();
      expect(test.state().budget?.billedIds).toHaveLength(1);
      expect(Object.keys(test.state().budget?.reservations ?? {})).toHaveLength(0);
      expect(usage.size).toBe(1);
    } finally { clock.mockRestore(); }
  });
  it("repairs a retained major edition before its future check date despite a complete page cache", async () => {
    const test = setup();
    await collectLongRange(test.input);
    const lead = test.state().leads[0];
    expect(lead.nextCheck).toBe("2026-09-14T12:00:00.000Z");
    delete lead.editions[0].evidence;
    lead.editions[0].latitude = null;
    lead.editions[0].longitude = null;
    const calls = test.create.mock.calls.length;
    const repaired = await collectLongRange(test.input);
    expect(test.create.mock.calls.length).toBeGreaterThan(calls);
    expect(repaired.candidates[0].evidence?.dateText).toBe(facts.dateText);
    expect(repaired.candidates[0].latitude).not.toBeNull();
    expect(test.state().leads[0].repair?.attemptedAt).toBe(now.toISOString());
    const repairedCalls = test.create.mock.calls.length;
    await collectLongRange(test.input);
    expect(test.create).toHaveBeenCalledTimes(repairedCalls);
  });

  it("retains valid discovery siblings and routes malformed official URLs to resolution", () => {
    const candidate = { title: "Arts Week", startDate: "2027-10-23", endDate: null, city: "Eindhoven", venue: null, category: "culture", officialUrl: url };
    const rejected = vi.fn();
    const parsed = parseDiscovery(JSON.stringify({ candidates: [candidate, { ...candidate, title: "Other festival", officialUrl: "not a URL" }, { title: 3 }], agendaUrls: [url, "bad"] }), rejected);
    expect(parsed.candidates).toHaveLength(2);
    expect(parsed.candidates[1].officialUrl).toBeNull();
    expect(parsed.agendaUrls).toEqual([url]);
    expect(rejected).toHaveBeenCalledTimes(3);
    expect(() => parseDiscovery(JSON.stringify({ candidates: [{ title: 3 }], agendaUrls: [] }))).toThrow("No usable");
  });

  it("falls back to the evidenced host city and preserves that centroid after a venue lookup fails", async () => {
    const quote = "The event takes place at Rotterdam Ahoy in Rotterdam.";
    const evidence = verifyEventEvidence({ ...facts, locationText: quote, hostCity: "Rotterdam", locationScope: "venue" }, url, [{ url, text: `${text} ${quote}` }], now.toISOString())!;
    const candidate = { venue: "Rotterdam Ahoy", latitude: null as number | null, longitude: null as number | null, evidence };
    const venue = vi.fn(async () => null);
    const city = vi.fn(async () => ({ latitude: 51.92, longitude: 4.48 }));
    await createLocationResolver({ venue, city })(candidate);
    expect(city).toHaveBeenCalledWith("Rotterdam");
    expect(candidate.evidence.locationResolution).toMatchObject({ method: "city_centroid", query: "Rotterdam" });
    expect(candidate.evidence.locationScope).toBe("venue");
    city.mockResolvedValue(null as never);
    await createLocationResolver({ venue, city })(candidate);
    expect(candidate.latitude).toBe(51.92);
    expect(city).toHaveBeenCalledTimes(1);
  });

  it.each(["venue", "citywide"] as const)("does not use an unsupported model-supplied host city for %s events", async (locationScope) => {
    const quote = "The event takes place at multiple venues across the city.";
    const evidence = verifyEventEvidence({ ...facts, locationText: quote, hostCity: "Rotterdam", hostCityText: "The event is hosted in Rotterdam.", locationScope }, url, [{ url, text: `${text} ${quote}` }], now.toISOString())!;
    const city = vi.fn(async () => ({ latitude: 51.92, longitude: 4.48 }));
    const candidate = { venue: "Exhibition centre", latitude: null, longitude: null, evidence };
    await createLocationResolver({ venue: async () => null, city })(candidate);
    expect(city).not.toHaveBeenCalled();
    expect(candidate.latitude).toBeNull();
  });

  it("keeps prior-edition local dates after Supabase timestamp serialization", () => {
    expect(eventLocalDate("2026-10-16T22:00:00+00:00")).toBe("2026-10-17");
    expect(eventLocalDate("2026-10-25T23:59:59+00:00")).toBe("2026-10-25");
  });

  it("retains the observed series website alongside an old venue page without importing future editions", async () => {
    const test = setup();
    test.state().leads = [];
    const venue = "https://venue.example/arts-2026";
    const seeds = [{ title: "Arts Week 2026", url: venue, officialPages: [venue, url], lastEditionStart: "2026-10-17", lastEditionEnd: "2026-10-25" }];
    test.pageFetcher.mockImplementation(async (requested: string) => parseOfficialPage(requested === venue ? "Previous venue programme for October 2026." : text, requested));
    const result = await collectLongRange({ ...test.input, seeds });
    expect(test.pageFetcher).toHaveBeenCalledWith(url);
    expect(result.candidates[0].evidence?.dateSourceUrl).toBe(url);
    expect(localParts(result.candidates[0].startAt).date).toBe("2027-10-23");
    expect(test.state().leads[0].knownEdition?.lastEditionEnd).toBe("2026-10-25");
  });

  it("checks a legacy citywide edition behind more than eighteen due leads and reuses city resolution", async () => {
    const test = setup();
    const legacy = (await collectLongRange(test.input)).candidates[0];
    delete legacy.evidence;
    legacy.latitude = null;
    legacy.longitude = null;
    delete test.state().cycle;
    test.state().leads = Array.from({ length: 24 }, (_, index) => makeLead({ key: `existing-${index}`, title: `Existing series ${index}`, url: `${url}/${index}`, checkedAt: "2026-09-01T00:00:00Z", nextCheck: "2026-09-06T00:00:00Z" }));
    test.state().leads.push(makeLead({ checkedAt: "2026-09-01T00:00:00Z", editions: [legacy] }));
    test.pageFetcher.mockImplementation(async (requested: string) => parseOfficialPage(text, requested));
    test.create.mockImplementation(async (request?: unknown) => {
      const prompt = JSON.stringify(request);
      const sourceUrl = prompt.match(/PAGE URL: (https:[^\\]+)\\n/)?.[1] ?? url;
      return { id: sourceUrl, stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 100 }, content: [{ type: "text", text: JSON.stringify({ events: [{ ...event, sourceUrl, facts: { ...facts, demand: [{ ...facts.demand[0], sourceUrl }] } }], reason: "Recorded-shape synthetic response", more: false }) }] };
    });
    const prior = { title: "Arts Week", url, lastEditionStart: "2026-10-17", lastEditionEnd: "2026-10-25", previousLocation: { venue: "Various locations in Eindhoven", text: "Across the city of Eindhoven", sourceUrl: url, checkedAt: "2026-09-01T00:00:00Z" } };
    const result = await collectLongRange({ ...test.input, seeds: [prior] });
    expect(test.state().leads.find((lead) => lead.key === "arts")?.checkedAt).toBe(now.toISOString());
    expect(result.candidates.some((candidate) => candidate.evidence?.locationResolution?.method === "city_centroid")).toBe(true);
    expect(test.city).toHaveBeenCalledTimes(1);
    expect(test.create.mock.calls.some((call) => JSON.stringify(call).includes("Various locations in Eindhoven"))).toBe(true);
    expect(test.state().leads.find((lead) => lead.key === "arts")?.knownEdition).toEqual(prior);
  });

  it("reuses only an unambiguous physical address on the host venue's own page", () => {
    const sourceUrl = "https://www.ahoy.nl/agenda";
    const quote = "The conference takes place at Rotterdam Ahoy.";
    const page = { url: sourceUrl, text: `${facts.dateText}\n${quote}\nRotterdam Ahoy\nAhoyweg 10\n3084BA Rotterdam` };
    const venueFacts = { ...facts, locationText: quote, hostCity: "Rotterdam", locationScope: "venue" as const };
    const evidence = verifyEventEvidence(venueFacts, sourceUrl, [page], now.toISOString(), { venue: "Rotterdam Ahoy", ownerType: "venue" });
    expect(evidence?.venueAddress).toBe("Ahoyweg 10\n3084BA Rotterdam");
    expect(evidence?.locationAddressEvidence?.sourceUrl).toBe(sourceUrl);
    expect(verifyEventEvidence(venueFacts, sourceUrl, [page], now.toISOString(), { venue: "Rotterdam Ahoy", ownerType: "organizer" })?.venueAddress).toBeNull();
    expect(verifyEventEvidence(venueFacts, sourceUrl, [{ ...page, text: `${page.text}\nAndereweg 20 3084BA Rotterdam` }], now.toISOString(), { venue: "Rotterdam Ahoy", ownerType: "venue" })?.venueAddress).toBeNull();
  });
  it("does not upgrade national visitor evidence to international audience", () => {
    const evidence = verifyEventEvidence(facts, url, [{ url, text }], now.toISOString());
    expect(supportedAudience(evidence, "national")).toBe("national");
    expect(supportedAudience(evidence, "international")).toBeNull();
    const players = "The best international tennis players compete on this court.";
    const unsupported = verifyEventEvidence({ ...facts, demand: [{ ...facts.demand[0], text: players }] }, url, [{ url, text: `${text} ${players}` }], now.toISOString());
    expect(unsupported?.demand).toEqual([]);
    expect(supportedAudience(unsupported, "international")).toBeNull();
    const worldwide = "The event attracts visitors from around the globe.";
    const globalEvidence = verifyEventEvidence({ ...facts, demand: [{ ...facts.demand[0], text: worldwide }] }, url, [{ url, text: `${text} ${worldwide}` }], now.toISOString());
    expect(supportedAudience(globalEvidence, "international")).toBe("international");
  });

  it("preserves the boundary between an official street number and postcode", () => {
    const page = parseOfficialPage('<p><span>Dommelstraat 2</span><span>5611 CK<!-- --> <!-- -->Eindhoven</span></p>', url);
    expect(page.text).toContain("Dommelstraat 2 5611 CK Eindhoven");
  });
  it("delivers a citywide edition and preserves local dates through score and export", async () => {
    const test = setup();
    const result = await collectLongRange(test.input);
    const candidate = result.candidates[0];
    expect(candidate.evidence?.locationResolution?.method).toBe("city_centroid");
    expect(candidate.attendance).toBeNull();
    const score = scoreHotelEvent({ candidate, hotel: { latitude: 51.44, longitude: 5.48, demandRadiusKm: 25, holidayRegion: null }, overlaps: [] });
    expect(score.suggestedImportance).toBe("Peak");
    const rows = mapRevControlRows([{ id: "event", title: candidate.title, startAt: candidate.startAt, endAt: candidate.endAt, hotels: [{ id: "hotel", code: "TEST", importance: score.suggestedImportance, impactBasis: score.impactBasis }] }], ["hotel"]);
    expect(rows[0].startDate.toISOString().slice(0, 10)).toBe("2027-10-23");
    expect(rows[0].endDate.toISOString().slice(0, 10)).toBe("2027-10-31");
  });

  it("keeps a strongly evidenced event outside the hotel radius below publication even with overlaps", async () => {
    const test = setup();
    const candidate = (await collectLongRange(test.input)).candidates[0];
    const result = scoreHotelEvent({ candidate, hotel: { latitude: 52.09, longitude: 5.12, demandRadiusKm: 25, holidayRegion: null }, overlaps: [{ startAt: candidate.startAt, endAt: candidate.endAt, preOverlapTotal: 80 }] });
    expect(result.distanceKm).toBeGreaterThan(25);
    expect(result.total).toBeLessThan(70);
  });

  it("checks a due discovered lead between monthly sweeps and reuses unchanged extraction", async () => {
    const test = setup();
    await collectLongRange(test.input);
    expect(test.create).toHaveBeenCalledTimes(1);
    await collectLongRange(test.input);
    expect(test.pageFetcher).toHaveBeenCalledTimes(1);
    const later = new Date("2026-09-14T12:00:00Z");
    test.state().announcementSearchAt = later.toISOString();
    await collectLongRange({ ...test.input, now: later });
    expect(test.pageFetcher).toHaveBeenCalledTimes(2);
    expect(test.create).toHaveBeenCalledTimes(1);
  });

  it("continues a calendar beyond eight entries without repeating extraction on a warm run", async () => {
    const test = setup();
    test.state().leads[0].kind = "calendar";
    let call = 0;
    test.create.mockImplementation(async () => ({ id: `page-${++call}`, stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 100 }, content: [{ type: "text", text: JSON.stringify({ events: Array.from({ length: call === 1 ? 8 : 1 }, (_, index) => ({ ...event, title: `Arts edition ${call === 1 ? index : 8}` })), reason: "Synthetic pagination response", more: call === 1 }) }] }));
    const result = await collectLongRange(test.input);
    expect(result.candidates).toHaveLength(9);
    expect(test.create).toHaveBeenCalledTimes(2);
    await collectLongRange(test.input);
    expect(test.create).toHaveBeenCalledTimes(2);
  });

  it("keeps deferred work due when the spend ceiling prevents dispatch", async () => {
    const test = setup();
    const result = await collectLongRange({ ...test.input, budgetEur: 0 });
    expect(test.create).not.toHaveBeenCalled();
    expect(test.state().leads[0].nextCheck).toBe(now.toISOString());
    expect(result.usage.budgetDeferred).toBe(1);
  });

  it("reuses released reservations for other due leads in the same pass", async () => {
    const test = setup();
    test.state().leads = Array.from({ length: 6 }, (_, index) => makeLead({ key: `lead-${index}`, title: `Arts ${index}`, url: `${url}/${index}` }));
    test.pageFetcher.mockImplementation(async (requested: string) => parseOfficialPage(text, requested));
    await collectLongRange({ ...test.input, budgetEur: 0.2 });
    // Each conservative extraction reservation is much larger than its recorded actual cost.
    const requests = test.create.mock.calls as unknown as [{ tools: unknown[] }][];
    expect(requests.filter(([request]) => !request.tools.length)).toHaveLength(3);
    expect(test.state().cycle?.waves).toBe(3);
    const calls = test.create.mock.calls.length;
    await collectLongRange({ ...test.input, budgetEur: 0.2 });
    expect(test.create).toHaveBeenCalledTimes(calls);
    expect(test.state().leads.filter((lead) => !lead.checkedAt).every((lead) => lead.nextCheck === now.toISOString())).toBe(true);
    expect(test.state().budget!.spentEur).toBeLessThan(0.2);
  });

  it("does not turn an official host-city mention into citywide location evidence", () => {
    const quote = "Van 3 tot en met 6 juni is het NK lange baan in Eindhoven, dit is tevens het kwalificatietoernooi voor het WK lange baan.";
    const title = "Wedstrijdzwemmen kalender 2026 - 2027";
    const evidence = verifyEventEvidence({ ...facts, dateText: quote, locationText: quote, announcedAt: "2026-03-25", announcementText: title, announcementSourceUrl: url }, url, [{ url, text: `${title}\n${quote}` }], now.toISOString());
    expect(evidence?.locationScope).toBe("unknown");
    expect(evidence?.announcedAt).toBeNull();
  });

  it("shares equally due first checks across event categories", () => {
    const leads = Array.from({ length: 20 }, (_, index) => makeLead({ key: `university-${index}`, title: `University ${index}`, group: 0 }));
    leads.push(makeLead({ key: "concert", title: "Major concert", group: 1 }));
    expect(selectDueLeads(leads, now, false).slice(0, 2).map((lead) => lead.key)).toContain("concert");
  });

  it("resumes an incomplete recorded calendar after a later fetch outage", async () => {
    const test = setup();
    test.state().leads[0].kind = "calendar";
    let call = 0, complete = false;
    test.create.mockImplementation(async () => ({ id: `continuation-${++call}`, stop_reason: "end_turn", usage: { input_tokens: 10000, output_tokens: 1000 }, content: [{ type: "text", text: JSON.stringify({ events: [{ ...event, title: `Arts edition ${call}` }], reason: "Synthetic chunk continuation", more: !complete }) }] }));
    const first = await collectLongRange({ ...test.input, budgetEur: 0.2 });
    expect(first.candidates.length).toBeGreaterThan(0);
    expect(test.state().pageCache?.[url]).toMatchObject({ text: expect.stringContaining(text), complete: false });
    expect(test.state().leads[0].nextCheck).toBe(now.toISOString());
    complete = true;
    test.pageFetcher.mockRejectedValue(new Error("Official fetch returned HTTP 403"));
    test.state().announcementSearchAt = "2026-09-14T12:00:00Z";
    const next = await collectLongRange({ ...test.input, now: new Date("2026-09-14T12:00:00Z") });
    expect(next.candidates.length).toBeGreaterThan(first.candidates.length);
    expect(test.state().pageCache?.[url].complete).toBe(true);
    expect(next.candidates.at(-1)?.evidence?.checkedAt).toBe(now.toISOString());
    expect(next.usage.blockedSources).toBe(1);
  });

  it("does not replace a newly announced host city with the previous edition's location", async () => {
    const test = setup();
    const movedText = text.replaceAll("Eindhoven", "Rotterdam");
    test.pageFetcher.mockResolvedValue(parseOfficialPage(movedText, url));
    test.create.mockResolvedValue({ id: "moved", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 100 }, content: [{ type: "text", text: JSON.stringify({ events: [{ ...event, facts: { ...facts, hostCity: "Rotterdam", locationText: "Across the city of Rotterdam." } }], reason: "Official host city changed", more: false }) }] });
    const seeds = [{ title: "Arts Week", url, lastEditionStart: "2026-10-17", lastEditionEnd: "2026-10-25", previousLocation: { venue: null, text: "Across Eindhoven", sourceUrl: url, checkedAt: "2026-09-01T00:00:00Z" } }];
    const result = await collectLongRange({ ...test.input, seeds });
    expect(test.city).toHaveBeenCalledWith("Rotterdam");
    expect(result.candidates[0].evidence?.hostCity).toBe("Rotterdam");
  });

  it("retains a dated edition with unresolved location instead of substituting the search city", async () => {
    const test = setup();
    test.create.mockResolvedValue({ id: "unknown-place", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 100 }, content: [{ type: "text", text: JSON.stringify({ events: [{ ...event, locationConfirmed: false, facts: { ...facts, locationText: "", hostCity: null, locationScope: "unknown" } }], reason: "Location unresolved", more: false }) }] });
    const result = await collectLongRange(test.input);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].latitude).toBeNull();
    expect(result.candidates[0].primarySourceConfirmed).toBe(false);
    expect(test.state().leads[0].pendingStage).toBe("location");
    expect(test.city).not.toHaveBeenCalled();
  });

  it("keeps provider-fetch fallback outside the rejected structured grammar", async () => {
    const test = setup();
    test.pageFetcher.mockRejectedValue(new Error("Official fetch returned HTTP 403"));
    await collectLongRange(test.input);
    const requests = test.create.mock.calls as unknown as [{ tools: { name: string }[]; output_config?: unknown }][];
    expect(requests.some(([request]) => request.tools.some((tool) => tool.name === "web_fetch") && !JSON.stringify(request.output_config).includes("events"))).toBe(true);
  });

  it("accepts a damaged URL only when its repaired value is an actually fetched page", async () => {
    const test = setup();
    test.create.mockResolvedValue({ id: "damaged-url", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 100 }, content: [{ type: "text", text: JSON.stringify({ events: [{ ...event, sourceUrl: `${url}/aten` }], reason: "Recorded URL suffix failure shape", more: false }) }] });
    const result = await collectLongRange(test.input);
    expect(result.candidates[0].sourceUrl).toBe(url);
    expect(result.usage.datesConfirmed).toBe(1);
  });

  it("keeps demand follow-up eligible when the date extraction is cached", async () => {
    const test = setup();
    test.create.mockImplementation(async (...args: unknown[]) => {
      const request = args[0] as { tools: unknown[] };
      return { id: String(test.create.mock.calls.length), stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 100 }, content: [{ type: "text", text: JSON.stringify(request.tools.length ? { url: null, reason: "No additional evidence yet" } : { events: [{ ...event, facts: { ...facts, demand: [] } }], reason: "Dates only", more: false }) }] };
    });
    await collectLongRange(test.input);
    expect(test.create).toHaveBeenCalledTimes(2);
    test.state().announcementSearchAt = "2026-09-14T12:00:00Z";
    await collectLongRange({ ...test.input, now: new Date("2026-09-14T12:00:00Z") });
    expect(test.create).toHaveBeenCalledTimes(3);
    expect(test.state().leads[0].pendingStage).toBe("demand");
  });

  it("finds an announcement on the next weekly check within the 14-day target", async () => {
    const test = setup();
    const confirmed = test.create.getMockImplementation()!;
    test.create.mockImplementation(async (...args: unknown[]) => ({ id: "before-announcement", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 100 }, content: [{ type: "text", text: JSON.stringify((args[0] as { tools: unknown[] }).tools.length ? { url: null, reason: "No announcement" } : { events: [], reason: "Not announced", more: false }) }] }));
    test.pageFetcher.mockResolvedValue(parseOfficialPage("Arts Week has not announced its next edition.", url));
    await collectLongRange(test.input);
    expect(test.state().leads[0].editions).toEqual([]);
    test.create.mockImplementation(confirmed);
    test.pageFetcher.mockResolvedValue(parseOfficialPage(text, url));
    const check = new Date("2026-09-14T12:00:00Z");
    test.state().announcementSearchAt = check.toISOString();
    const result = await collectLongRange({ ...test.input, now: check });
    expect(result.candidates).toHaveLength(1);
    expect(Date.parse(result.candidates[0].evidence!.checkedAt) - Date.parse("2026-09-08T12:00:00Z")).toBeLessThanOrEqual(14 * 86400000);
  });

  it("keeps confirmed editions available across the near-term boundary", async () => {
    const test = setup();
    await collectLongRange(test.input);
    const result = await collectLongRange({ ...test.input, start: "2027-10-25" });
    expect(result.candidates).toHaveLength(1);
  });

  it("processes a cancellation after a stored edition enters the near-term window", async () => {
    const test = setup();
    await collectLongRange(test.input);
    const later = new Date("2027-09-07T12:00:00Z");
    test.state().announcementSearchAt = later.toISOString();
    test.state().discoveredAt = later.toISOString();
    test.pageFetcher.mockResolvedValue(parseOfficialPage(`${text} This edition is cancelled.`, url));
    test.create.mockResolvedValue({ id: "cancellation", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 100 }, content: [{ type: "text", text: JSON.stringify({ events: [{ ...event, status: "cancelled" }], reason: "Recorded cancellation rule", more: false }) }] });
    const result = await collectLongRange({ ...test.input, now: later, start: "2027-12-07" });
    expect(result.candidates[0].sourceState).toBe("cancelled");
    expect(JSON.stringify(test.create.mock.calls.at(-1))).toContain("between 2027-09-07 and 2027-12-31");
  });

  it("keeps the freshest verified edition across overlapping collection horizons", async () => {
    const test = setup();
    const cached = await collectLongRange(test.input);
    const old = cached.candidates[0];
    const current = { ...old, sourceState: "cancelled" as const, evidence: { ...old.evidence!, checkedAt: "2027-09-07T12:00:00Z" } };
    const collect = (candidate: typeof old) => vi.fn().mockResolvedValue({ ...cached, candidates: [candidate] });
    const input = { ...test.input, longRangeEnabled: true };
    const combined = await collectClaudeCalendar(input, collect(current), collect(old));
    expect(combined.candidates).toEqual([current]);
    expect(combined.usage).toMatchObject({ nearTermOnlyEditions: 0, monitoringOnlyEditions: 0, overlappingEditions: 1 });
    expect((await collectClaudeCalendar(input, collect({ ...current, evidence: undefined, primarySourceConfirmed: false }), collect(old))).candidates).toEqual([old]);
  });

  it("retains legacy UTC placeholders without inventing a date conflict during migration", async () => {
    const test = setup();
    await collectLongRange(test.input);
    const stored = test.state().leads[0].editions[0];
    stored.startAt = "2027-10-23T00:00:00Z";
    stored.endAt = "2027-10-31T23:59:59Z";
    test.state().pageCache = {};
    test.state().leads[0].nextCheck = now.toISOString();
    const result = await collectLongRange(test.input);
    expect(result.quarantinedProviderEventIds).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    expect(test.state().leads[0].editions).toHaveLength(1);
  });

  it("does not merge separate performances or quarantine them as changed dates", async () => {
    const test = setup();
    let call = 0;
    const concert = { ...event, category: "concerts", facts: { ...facts, continuous: false } };
    test.create.mockImplementation(async () => ({ id: `performance-${++call}`, stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 100 }, content: [{ type: "text", text: JSON.stringify({ events: [{ ...concert, startAt: call === 1 ? "2027-10-23" : "2027-10-25", endAt: call === 1 ? "2027-10-23" : "2027-10-25" }], reason: "Separate performances", more: call === 1 }) }] }));
    const result = await collectLongRange(test.input);
    expect(result.candidates).toHaveLength(2);
    expect(result.quarantinedProviderEventIds).toEqual([]);
    expect(new Set(result.candidates.map((candidate) => candidate.providerEventId)).size).toBe(2);
  });

  it("requires documented historical applicability and never copies historical attendance", async () => {
    const test = setup();
    const historical = { ...facts.demand[0], scope: "historical", year: 2026 };
    test.create.mockResolvedValue({ id: "historical", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 100 }, content: [{ type: "text", text: JSON.stringify({ events: [{ ...event, attendance: 300000, facts: { ...facts, demand: [historical] } }], reason: "Comparable history", more: false }) }] });
    const result = await collectLongRange(test.input);
    expect(result.candidates[0].attendance).toBeNull();
    expect(result.candidates[0].evidence?.demand[0].year).toBe(2026);
    expect(verifyEventEvidence({ ...facts, demand: [{ ...facts.demand[0], applicability: null }] }, url, [{ url, text }], now.toISOString())?.demand).toEqual([]);
  });

  it("does not prune or starve first checks behind portfolio scores", () => {
    const leads = Array.from({ length: 30 }, (_, index) => makeLead({ key: String(index), checkedAt: index < 20 ? now.toISOString() : null, historicalDemandPoints: index < 20 ? 60 : 0 }));
    expect(selectDueLeads(leads, now, false).filter((lead) => !lead.checkedAt).length).toBeGreaterThanOrEqual(5);
  });

  it("rejects fabricated demand passages and inapplicable historical evidence", () => {
    const evidence = verifyEventEvidence({ ...facts, demand: [{ ...facts.demand[0], text: "One million foreign visitors stay overnight" }, { ...facts.demand[0], comparable: false }] }, url, [{ url, text }], now.toISOString());
    expect(evidence?.demand).toEqual([]);
  });

  it.each(["2027-03-28", "2027-10-31"])("preserves local day boundaries on the DST transition %s", (date) => {
    expect(localParts(localDateBoundary(date))).toMatchObject({ date, hour: 0 });
    expect(localParts(localDateBoundary(date, true))).toMatchObject({ date, hour: 23 });
  });

  it("refuses ambiguous towns", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ response: { docs: [{ woonplaatsnaam: "Bergen", centroide_ll: "POINT(4.7 52.6)" }, { woonplaatsnaam: "Bergen", centroide_ll: "POINT(6 51.6)" }] } }) });
    expect(await geocodeCity("Bergen", fetcher)).toBeNull();
  });

  it("reserves before dispatch, deduplicates billed IDs and drops stale reservations at month rollover", () => {
    const state: LongRangeState = { version: 2003, discoveredAt: null, leads: [] };
    const budget = researchBudget(state, now);
    const request = { model: "claude-sonnet-5", max_tokens: 100, messages: [{ role: "user" as const, content: "test" }] };
    const key = budget.reserve(request, false)!;
    expect(budget.reserve(request, false)).toBeNull();
    const usage = { requestId: "same", phase: "discovery" as const, model: request.model, inputTokens: 100, outputTokens: 100, webFetchRequests: 0, webSearchRequests: 0 };
    budget.settle(key, usage, false);
    const spent = state.budget!.spentEur;
    budget.settle(key, usage, false);
    expect(state.budget!.spentEur).toBe(spent);
    budget.reserve(request, false);
    expect(Object.keys(state.budget!.reservations)).toHaveLength(1);
    const nextMonth = researchBudget(state, new Date("2026-10-01"));
    // An Anthropic batch expires within 24h, so no reservation can outlive its own month.
    expect(state.budget!.reservations).toEqual({});
    nextMonth.settle(key, usage, false);
    expect(state.budget!.spentEur).toBe(0);
    expect(state.budget!.billedIds).toEqual(["same"]);
  });

  it("releases the reservation for a batch request that terminally errored", async () => {
    const test = setup();
    let row: Awaited<ReturnType<BatchStore["get"]>> = null;
    let params: { requests: { custom_id: string }[] };
    const batchStore: BatchStore = {
      removeExpired: async () => {}, get: async () => row,
      claim: async () => { row = { status: "creating", batch_id: null, results: null, error: null, created_at: new Date().toISOString() }; return true; },
      attach: async (_key, _owner, batchId) => { row = { ...row!, status: "processing", batch_id: batchId }; },
      complete: async (_key, results) => { row = { ...row!, status: "completed", results }; },
      fail: async () => {}, release: async () => {}, claimUsage: async () => false,
    };
    const client = { messages: { batches: {
      create: vi.fn(async (input: { requests: { custom_id: string }[] }) => { params = input; return { id: "errored-batch" }; }),
      retrieve: async () => ({ processing_status: "ended" }),
      // A canceled, expired or errored batch reports per-request failures, never an APIError.
      results: async function* () { for (const request of params.requests) yield { custom_id: request.custom_id, result: { type: "errored", error: { type: "invalid_request_error" } } }; },
    } } } as unknown as Anthropic;

    await collectLongRange({ ...test.input, client, batching: { enabled: true, store: batchStore } });

    expect(Object.keys(test.state().budget?.reservations ?? {})).toHaveLength(0);
  });

  it("attributes a spend-ceiling stop to the budget and not to the research cycle", async () => {
    const test = setup();

    const starved = await collectLongRange({ ...test.input, budgetEur: 0 });
    expect(starved.usage.budgetDeferred).toBeGreaterThan(0);
    expect(starved.usage.cycleDeferred).toBe(0);

    // The wave cap stops work before dispatch is reached (long-range.ts:687), so a capped cycle
    // must not borrow the budget's reason for the leads it leaves due.
    test.state().cycle!.waves = 3;
    const capped = await collectLongRange(test.input);
    expect(test.create).not.toHaveBeenCalled();
    expect(capped.usage.budgetDeferred).toBe(0);
    expect(capped.usage.overdueLeads).toBeGreaterThan(0);
  });
});

import { expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { collectLongRange } from "./long-range";
import { pageHash, parseOfficialPage } from "../official-pages";
import type { LongRangeState, LongRangeStore } from "../long-range-store";

it("fetches linked pages in code and accepts only supplied page evidence, without model fetch tools", async () => {
  const now = new Date("2026-09-05T12:00:00Z");
  let state: LongRangeState = { version: 2003, discoveredAt: now.toISOString(), leads: [{
    key: "arts", title: "Annual Arts Week", url: "https://organizer.example/", kind: "event", group: 1,
    outcome: "pending", nextCheck: now.toISOString(), checkedAt: null, editions: [], notes: [],
  }] };
  const store: LongRangeStore = { acquire: async () => true, release: async () => {}, load: async () => state,
    save: async (_key, value) => { state = structuredClone(value); } };
  const pageFetcher = vi.fn(async (url: string) => parseOfficialPage(url.endsWith("/about")
    ? "Annual Arts Week, Eindhoven. Future dates: 23–31 October 2027."
    : '<a href="/about">About</a>Annual Arts Week 2026.', url));
  const create = vi.fn(async () => ({ stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 }, content: [{ type: "text", text: JSON.stringify({ events: [{
    sourceUrl: "https://organizer.example/about", title: "Annual Arts Week", category: "culture", venue: null, latitude: null, longitude: null,
    regionScope: "Eindhoven", startAt: "2027-10-23", endAt: "2027-10-31", status: "active", ownerType: "organizer",
    evidenceText: "Future dates: 23–31 October 2027", attendance: null, venueCapacity: null, impactPoints: null,
    overnightAudience: null, titleConfirmed: true, dateConfirmed: true, locationConfirmed: true,
  }], reason: "Supplied official text" }) }] }));
  const input = { start: "2027-01-01", end: "2027-12-31", location: "Eindhoven", radiusKm: 25, now, model: "claude-sonnet-5",
    client: { messages: { create } } as unknown as Anthropic, batching: { enabled: false }, pageFetcher, store };
  const result = await collectLongRange(input);
  expect(result.candidates[0]).toMatchObject({ startAt: "2027-10-22T22:00:00.000Z", aiImpactPoints: null });
  expect(pageFetcher).toHaveBeenCalledTimes(2);
  // Missing date facts need extraction repair, not another location-search request.
  expect(create).toHaveBeenCalledTimes(1);
  expect(result.candidates[0].primarySourceConfirmed).toBe(false);
  expect(state.leads[0].pendingStage).toBe("extraction");
  expect((create.mock.calls as unknown[][])[0][0]).toMatchObject({ tools: [] });
  expect(state.leads[0].officialPage).toBe("https://organizer.example/about");
  expect((await collectLongRange(input)).requests).toBe(0);
  expect(pageFetcher).toHaveBeenCalledTimes(2);
});

// North Sea Jazz, Rotterdam: the saved lead pointed at a 2026 news item while the language
// homepage already announced 9-11 July 2027.
it("reads the homepage before a stored past-year news page and finds the next edition", async () => {
  const now = new Date("2026-10-05T12:00:00Z");
  const article = "https://www.northseajazz.com/en/news/programme-2026";
  const homepage = "https://www.northseajazz.com/en/";
  const dateText = "NN North Sea Jazz 2027 09 10 11 July";
  const locationText = "North Sea Jazz takes place at Rotterdam Ahoy in Rotterdam.";
  const demandText = "Festival visitors can book their stay through the official hotel partner.";
  let state: LongRangeState = { version: 2003, discoveredAt: now.toISOString(), leads: [{
    key: "nsj", title: "North Sea Jazz Festival", url: article, officialPages: [article, "https://www.northseajazz.com/en/tickets"],
    kind: "event", group: 4, attempts: 5, outcome: "unannounced", nextCheck: now.toISOString(),
    checkedAt: "2026-09-05T12:00:00Z", editions: [], notes: ["No published future dates"],
  }] };
  const store: LongRangeStore = { acquire: async () => true, release: async () => {}, load: async () => state,
    save: async (_key, value) => { state = structuredClone(value); } };
  const pageFetcher = vi.fn(async (requested: string) => parseOfficialPage(
    requested === homepage ? `${dateText}\n${locationText}\n${demandText}` : "North Sea Jazz information.",
    requested,
  ));
  const edition = {
    sourceUrl: homepage, title: "North Sea Jazz Festival", category: "festival", venue: "Rotterdam Ahoy",
    startAt: "2027-07-09", endAt: "2027-07-11", status: "active", ownerType: "organizer",
    attendance: null, venueCapacity: null, impactPoints: 60, overnightAudience: "international",
    titleConfirmed: true, dateConfirmed: true, locationConfirmed: true,
    facts: { dateText, locationText, venueAddress: "Rotterdam Ahoy", hostCity: "Rotterdam", locationScope: "venue", continuous: true, majorCompetition: false,
      demand: [{ sourceUrl: homepage, kind: "hotel_stay", text: demandText, scope: "series", year: null, comparable: true, applicability: "Official accommodation offer for the same continuing festival series." }] },
  };
  const create = vi.fn(async () => ({ stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 },
    content: [{ type: "text", text: JSON.stringify({ events: [edition], reason: "The homepage announces 2027", more: false }) }] }));
  const result = await collectLongRange({ start: "2027-01-01", end: "2027-12-31", location: "Rotterdam", radiusKm: 25,
    now, model: "claude-sonnet-5", client: { messages: { create } } as unknown as Anthropic, batching: { enabled: false },
    pageFetcher, store, geocode: async () => ({ latitude: 51.882, longitude: 4.488 }) });
  expect(pageFetcher.mock.calls.map(([requested]) => requested)).toEqual([homepage, "https://www.northseajazz.com/"]);
  expect(result.candidates).toMatchObject([{ title: "North Sea Jazz Festival", venue: "Rotterdam Ahoy", primarySourceConfirmed: true }]);
  expect(state.leads[0]).toMatchObject({ outcome: "confirmed", officialPage: homepage });
});

// Brainport Eindhoven, 2026-10-14: its agenda lives at /nl/evenementen. Reading the language
// home and the site root first used both page slots, so PIC Summit Europe was never seen.
it("reads a listed agenda page itself before any homepage", async () => {
  const now = new Date("2026-10-14T12:00:00Z");
  const agenda = "https://brainport.example/nl/evenementen";
  let state: LongRangeState = { version: 2003, discoveredAt: now.toISOString(), leads: [{
    key: "brainport", title: "Brainport Eindhoven evenementen", url: agenda, kind: "calendar", origin: "venue_list", group: 0,
    outcome: "pending", nextCheck: now.toISOString(), checkedAt: null, editions: [], notes: [],
  }] };
  const store: LongRangeStore = { acquire: async () => true, release: async () => {}, load: async () => state,
    save: async (_key, value) => { state = structuredClone(value); } };
  const pageFetcher = vi.fn(async (requested: string) => parseOfficialPage(
    requested === agenda ? "PIC Summit Europe 2026 03 nov - 04 nov Evoluon" : "Welkom bij Brainport", requested));
  const create = vi.fn(async () => ({ stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 },
    content: [{ type: "text", text: JSON.stringify({ events: [], reason: "Read", more: false }) }] }));
  await collectLongRange({ start: "2026-10-14", end: "2027-12-31", location: "Eindhoven", radiusKm: 25,
    now, model: "claude-sonnet-5", client: { messages: { create } } as unknown as Anthropic, batching: { enabled: false },
    pageFetcher, store, geocode: async () => ({ latitude: 51.44, longitude: 5.48 }) });
  expect(pageFetcher.mock.calls[0][0]).toBe(agenda);
});

// Klokgebouw, Eindhoven, 2026-10-14: the venue agenda was read through the VERKNIPT NYE lead, which
// kept Revolution Calling. The festival's own lead never got the edition, so no search ever asked
// how many visitors it draws and hotels never saw it.
it("files an edition found on another lead's page under its own series and looks up its audience next cycle", async () => {
  const now = new Date("2026-10-14T12:00:00Z");
  const agenda = "https://venue.example/agenda";
  const page = "vr. 20 nov. Rock Big Festival\nza. 21 nov. Rock Big Festival\ndi. 3 nov. - wo. 4 nov. Photonics Summit\nwo. 31 dec. Club Night NYE\nVenue Hall, Hallweg 1, 5617 AB Eindhoven";
  const facts = (dateText: string) => ({ dateText, locationText: "Venue Hall, Hallweg 1, 5617 AB Eindhoven", venueAddress: "Hallweg 1, 5617 AB Eindhoven",
    hostCity: "Eindhoven", locationScope: "venue", continuous: true, majorCompetition: false, demand: [] });
  const edition = (title: string, startAt: string, endAt: string, dateText: string, sourceUrl = agenda) => ({ sourceUrl, title, category: "festival", venue: "Venue Hall",
    startAt, endAt, status: "active", ownerType: "venue", attendance: null, venueCapacity: null, impactPoints: null, overnightAudience: null,
    titleConfirmed: true, dateConfirmed: true, locationConfirmed: true, facts: facts(dateText) });
  let state: LongRangeState = { version: 2003, discoveredAt: now.toISOString(), announcementSearchAt: now.toISOString(), lastSweepAt: now.toISOString(), leads: [
    { key: "club", title: "Club Night NYE", url: agenda, kind: "event", group: 1, outcome: "pending", nextCheck: now.toISOString(), checkedAt: null, editions: [], notes: [] },
    { key: "festival", title: "Big Festival", url: "https://venue.example/practical", kind: "event", group: 0, outcome: "failed",
      nextCheck: "2026-10-29T12:00:00Z", checkedAt: "2026-09-29T12:00:00Z", attempts: 1, editions: [], notes: ["No fetched official page"] },
    { key: "hub", title: "Venue Hall agenda", url: "https://venue.example/calendar", kind: "calendar", origin: "venue_list", group: 0, outcome: "pending",
      nextCheck: now.toISOString(), checkedAt: null, editions: [], notes: [] },
  ] };
  const store: LongRangeStore = { acquire: async () => true, release: async () => {}, load: async () => state,
    save: async (_key, value) => { state = structuredClone(value); } };
  const searches: string[] = [];
  const create = vi.fn(async (request: { messages: { content: unknown }[] }) => {
    const text = JSON.stringify(request.messages);
    // Only the agenda carries dates; the festival's own lead points at a practical-information page.
    const body = text.includes("Search once for") ? (searches.push(text), { url: null, reason: "No audience page" })
      : text.includes("Lead: Big Festival") ? { events: [], reason: "Practical information only", more: false }
      : text.includes("Lead: Venue Hall agenda") ? { events: [edition("Photonics Summit", "2026-11-03", "2026-11-04", "di. 3 nov. - wo. 4 nov. Photonics Summit", "https://venue.example/calendar")], reason: "Agenda", more: false }
      : { events: [edition("Big Festival", "2026-11-20", "2026-11-21", "vr. 20 nov. Rock Big Festival\nza. 21 nov. Rock Big Festival"),
        edition("Club Night NYE", "2026-12-31", "2026-12-31", "wo. 31 dec. Club Night NYE")], reason: "Agenda", more: false };
    return { stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: "text", text: JSON.stringify(body) }] };
  });
  const run = (at: Date) => collectLongRange({ start: "2026-10-14", end: "2027-12-31", location: "Eindhoven", radiusKm: 25,
    now: at, model: "claude-sonnet-5", client: { messages: { create } } as unknown as Anthropic, batching: { enabled: false },
    pageFetcher: async (url: string) => parseOfficialPage(page, url), store, geocode: async () => ({ latitude: 51.45, longitude: 5.46 }) });
  await run(now);
  const festival = () => state.leads.find((lead) => lead.key === "festival")!;
  expect(festival().editions.map((item) => item.title)).toEqual(["Big Festival"]);
  expect(festival()).toMatchObject({ nextCheck: now.toISOString(), pendingStage: "demand" });
  // PIC Summit Europe, 2026-10-14: an event with no lead of its own is looked up before its dates.
  expect(state.leads.find((lead) => lead.title === "Photonics Summit")).toMatchObject({ nextCheck: now.toISOString(), pendingStage: "demand" });
  await run(new Date("2026-10-21T12:00:00Z"));
  expect(searches.some((text) => text.includes("Big Festival bezoekers herkomst"))).toBe(true);
  expect(searches.some((text) => text.includes("Photonics Summit bezoekers herkomst"))).toBe(true);
});

it("does not call a next edition unannounced from only a past-year article", async () => {
  const now = new Date("2026-10-05T12:00:00Z");
  const article = "https://organizer.example/news/programme-2026";
  let state: LongRangeState = { version: 2003, discoveredAt: now.toISOString(), leads: [{
    key: "festival", title: "Annual Festival", url: article, kind: "event", group: 4,
    outcome: "pending", nextCheck: now.toISOString(), checkedAt: null, editions: [], notes: [],
  }] };
  const store: LongRangeStore = { acquire: async () => true, release: async () => {}, load: async () => state,
    save: async (_key, value) => { state = structuredClone(value); } };
  const pageFetcher = vi.fn(async (requested: string) => {
    if (requested === "https://organizer.example/") throw new Error("Homepage unavailable");
    return parseOfficialPage("<title>Annual Festival 2026 programme</title>Past edition dates", requested);
  });
  const create = vi.fn(async (request: { tools: { name: string }[] }) => {
    const body = request.tools.some((tool) => tool.name === "web_search")
      ? { url: null, reason: "No later official page found" }
      : { events: [], reason: "Only the 2026 edition is present", more: false };
    return { stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: "text", text: JSON.stringify(body) }] };
  });
  await collectLongRange({ start: "2027-01-01", end: "2027-12-31", location: "Rotterdam", radiusKm: 25,
    now, model: "claude-sonnet-5", client: { messages: { create } } as unknown as Anthropic, batching: { enabled: false },
    pageFetcher, store });
  expect(state.leads[0]).toMatchObject({ outcome: "pending", pendingStage: "retrieval" });
});

// Concert at SEA, Burgh-Haamstede, 2026-09-14: the lead was pinned to a tourist page that reset
// the connection on all four attempts. Its own organiser pages downloaded fine and were cached,
// but the cache marked them fully extracted, so the lead was finalized with no edition and the
// drop read "No fetched official page" while the 2027 dates sat in storage.
const stuck = (overrides: Partial<LongRangeState["leads"][number]> = {}) => ({
  key: "sea", title: "Concert at Sea", url: "https://tourist.example/events/concert-at-sea/",
  officialPages: ["https://organizer.example/", "https://organizer.example/news/2027/"],
  kind: "event" as const, group: 1, attempts: 4, outcome: "failed" as const, pendingStage: "retrieval" as const,
  nextCheck: "2026-09-21T18:00:00Z", checkedAt: "2026-09-14T18:00:00Z", editions: [], notes: ["No fetched official page"],
  ...overrides,
});
const announcement = "Concert at Sea, Brouwersdam. Tot volgend jaar: 24 + 25 + 26 juni 2027.";

function stuckMarket(lead: Partial<LongRangeState["leads"][number]> = {}) {
  const now = new Date("2026-09-22T09:00:00Z");
  const page = parseOfficialPage(announcement, "https://organizer.example/");
  let state: LongRangeState = {
    version: 2003, discoveredAt: "2026-09-14T11:50:00Z", announcementSearchAt: "2026-09-14T11:50:00Z",
    lastSweepAt: "2026-09-14T11:50:00Z", leads: [stuck(lead)],
    // Both official pages are recorded as completely extracted at the current version.
    pageCache: { "https://organizer.example/": { text: page.text, links: page.links, hash: pageHash(page),
      version: 352027, cursor: 1, chunks: 1, complete: true, checkedAt: "2026-09-14T18:00:00Z" } },
    retrievalFailures: { "https://tourist.example/events/concert-at-sea/": { checkedAt: "2026-09-14T18:00:00Z", message: "read ECONNRESET" } },
    cycle: { monitoringVersion: 3, startedAt: "2026-09-14T11:50:00Z", waves: 5, finished: true, leadKeys: ["sea"], queued: [],
      retrieved: { sea: ["https://organizer.example/", "https://tourist.example/events/concert-at-sea/"] } },
  };
  const fetched: string[] = [];
  const pageFetcher = vi.fn(async (url: string) => {
    fetched.push(url);
    if (url.startsWith("https://tourist.example")) throw new Error("read ECONNRESET");
    return parseOfficialPage(announcement, url);
  });
  const create = vi.fn(async (params: { messages: unknown[] }) => {
    const text = JSON.stringify(params.messages);
    const body = /Search once for|official page of this event series/.test(text)
      ? { url: null, reason: "No further official page" }
      : { reason: "Official page announces the 2027 dates", more: false, events: [{
        sourceUrl: "https://organizer.example/", title: "Concert at SEA 2027", category: "festival", venue: "Brouwersdam",
        latitude: null, longitude: null, regionScope: null, startAt: "2027-06-24", endAt: "2027-06-26",
        status: "active", ownerType: "organizer", evidenceText: "Tot volgend jaar: 24 + 25 + 26 juni 2027",
        attendance: null, venueCapacity: null, impactPoints: 45, overnightAudience: "national",
        titleConfirmed: true, dateConfirmed: true, locationConfirmed: true,
        facts: { dateText: "Tot volgend jaar: 24 + 25 + 26 juni 2027", dateSourceUrl: "https://organizer.example/",
          locationText: "Brouwersdam", locationSourceUrl: "https://organizer.example/", hostCity: "Scharendijke",
          hostCityText: "Brouwersdam", locationScope: "venue", continuous: true, majorCompetition: false, demand: [] },
      }] };
    return { stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: "text", text: JSON.stringify(body) }] };
  });
  const store: LongRangeStore = { acquire: async () => true, release: async () => {}, load: async () => state,
    save: async (_key, value) => { state = structuredClone(value); } };
  const run = () => collectLongRange({ start: "2026-12-10", end: "2027-12-31", location: "Burgh-Haamstede", radiusKm: 35,
    now, model: "claude-sonnet-5", client: { messages: { create } } as unknown as Anthropic, batching: { enabled: false },
    pageFetcher, store, geocode: async () => { throw new Error("Test must not geocode"); }, geocodeCity: async () => null });
  return { run, fetched, create, lead: () => state.leads[0], state: () => state };
}

it("re-reads pages a failed lead never turned into an edition", async () => {
  const market = stuckMarket();
  const result = await market.run();
  expect(result.candidates).toMatchObject([{ title: "Concert at SEA 2027", startAt: "2027-06-23T22:00:00.000Z" }]);
  expect(market.lead()).toMatchObject({ outcome: "confirmed", editions: [{ title: "Concert at SEA 2027" }] });
});

it("hands the retrieval slot to an official page when the pinned target refuses", async () => {
  const market = stuckMarket();
  await market.run();
  expect(market.fetched).toContain("https://tourist.example/events/concert-at-sea/");
  expect(market.lead().url).toBe("https://organizer.example/");
});

it("re-reads cached pages once per extraction version, not every week", async () => {
  const market = stuckMarket({ extractedVersion: 352027 });
  const result = await market.run();
  expect(result.candidates).toEqual([]);
  // The lead keeps its own dead end instead of paying to re-read identical text weekly.
  expect(market.lead().editions).toEqual([]);
});

it("never re-reads a lead whose pages were read and reported nothing announced", async () => {
  const market = stuckMarket({ outcome: "unannounced", pendingStage: undefined, notes: ["No published future dates"] });
  const result = await market.run();
  expect(result.candidates).toEqual([]);
  expect(market.lead().outcome).toBe("unannounced");
});

// Onder De Radar, Enschede: dates and venue proved, no hotel quote on any official page. 159 such
// leads bought a demand search every week and outranked leads never checked once.
function demandMarket(spent?: number, options: { budgetEur?: number; scope?: string } = {}) {
  const now = new Date("2026-09-22T09:00:00Z");
  const page = parseOfficialPage("Onder De Radar, Vliegbasis Twenthe. Wanneer: 27 & 28 augustus 2027.", "https://organizer.example/");
  const edition = {
    provider: "claude" as const, providerEventId: "odr", sourceUrl: "https://organizer.example/",
    title: "Onder De Radar Festival", category: "festival", venue: "Vliegbasis Twenthe",
    latitude: 52.22, longitude: 6.87, regionScope: "Enschede", startAt: "2027-08-26T22:00:00.000Z",
    endAt: "2027-08-28T21:59:59.000Z", sourceState: "active" as const, certainty: "confirmed" as const,
    localRank: null, attendance: null, venueCapacity: null, aiImpactPoints: 35, overnightAudience: null,
    evidenceText: null, primarySourceConfirmed: true, assessmentVersion: 5,
    evidence: { dateText: "Wanneer: 27 & 28 augustus 2027.", dateSourceUrl: "https://organizer.example/",
      locationText: "Vliegbasis Twenthe", venueAddress: "Vliegbasis Twenthe", hostCity: "Enschede",
      locationScope: "venue" as const, continuous: true, majorCompetition: false, demand: [],
      locationResolution: { query: "Vliegbasis Twenthe", method: "venue" as const, latitude: 52.22, longitude: 6.87 },
      assessmentVersion: 5, checkedAt: "2026-09-14T18:00:00Z" },
  };
  let state: LongRangeState = {
    version: 2003, discoveredAt: "2026-09-14T11:50:00Z", announcementSearchAt: "2026-09-14T11:50:00Z",
    lastSweepAt: "2026-09-14T11:50:00Z",
    leads: [{ key: "odr", title: "Onder De Radar Festival", url: "https://organizer.example/",
      officialPages: ["https://organizer.example/"], kind: "event", group: 1, attempts: 5,
      outcome: "confirmed", pendingStage: "demand", nextCheck: "2026-09-21T18:00:00Z",
      ...(spent === undefined ? {} : { demandSearches: { scope: options.scope ?? "odr", attempts: spent } }),
      checkedAt: "2026-09-14T18:00:00Z", editions: [edition], notes: ["No hotel evidence"] }],
    pageCache: { "https://organizer.example/": { text: page.text, links: page.links, hash: pageHash(page),
      version: 352027, cursor: 1, chunks: 1, complete: true, checkedAt: "2026-09-14T18:00:00Z" } },
    cycle: { monitoringVersion: 3, startedAt: "2026-09-14T11:50:00Z", waves: 5, finished: true, leadKeys: ["odr"], queued: [] },
  };
  const queries: string[] = [];
  const create = vi.fn(async (params: { messages: unknown[] }) => {
    queries.push(JSON.stringify(params.messages));
    return { stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 },
      content: [{ type: "text", text: JSON.stringify({ url: null, reason: "No audience evidence published" }) }] };
  });
  const store: LongRangeStore = { acquire: async () => true, release: async () => {}, load: async () => state,
    save: async (_key, value) => { state = structuredClone(value); } };
  const result = () => collectLongRange({ start: "2026-12-10", end: "2027-12-31", location: "Enschede", radiusKm: 50,
    now, model: "claude-sonnet-5", client: { messages: { create } } as unknown as Anthropic, batching: { enabled: false },
    ...(options.budgetEur === undefined ? {} : { budgetEur: options.budgetEur }),
    pageFetcher: async (url: string) => parseOfficialPage("Onder De Radar, Vliegbasis Twenthe. Wanneer: 27 & 28 augustus 2027.", url),
    store, geocode: async () => ({ latitude: 52.22, longitude: 6.87 }), geocodeCity: async () => null });
  return { run: result, queries, lead: () => state.leads[0] };
}

it("searches for missing hotel evidence while the allowance lasts", async () => {
  const market = demandMarket(1);
  const result = await market.run();
  expect(market.lead().demandSearches).toEqual({ scope: "odr", attempts: 2 });
  expect(result.usage.demandSearchExhausted).toBe(1);
});

it("stops buying demand searches the official pages cannot answer, keeping the proven edition", async () => {
  const market = demandMarket(2);
  const result = await market.run();
  const queries = market.queries;
  expect(queries.some((query) => /overnachten official visitors hotels/.test(query))).toBe(false);
  expect(market.lead().pendingStage).toBeUndefined();
  expect(market.lead().editions).toHaveLength(1);
  expect(result.candidates).toMatchObject([{ title: "Onder De Radar Festival", primarySourceConfirmed: true }]);
});

it("charges the allowance only for a search that actually ran", async () => {
  const market = demandMarket(0, { budgetEur: 0 });
  const result = await market.run();
  expect(result.requests).toBe(0);
  expect(market.lead().demandSearches?.attempts ?? 0).toBe(0);
  // Nothing was bought, so the postponed lead must still be able to buy it later.
  expect(market.lead().pendingStage).toBe("demand");
});

it("gives a newly announced edition its own allowance", async () => {
  // The 2027 edition used both searches. The 2028 edition is a different question.
  const market = demandMarket(2, { scope: "odr-2027" });
  await market.run();
  expect(market.queries.some((query) => /overnachten official visitors hotels/.test(query))).toBe(true);
  expect(market.lead().demandSearches).toEqual({ scope: "odr", attempts: 1 });
});

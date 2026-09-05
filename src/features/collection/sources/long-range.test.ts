import { afterEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { collectLongRange, isAggregatorUrl, nextCheckAt, pruneLeads, repairObservedUrl, selectDueLeads, selectResolveLeads } from "./long-range";
import { collectClaudeCalendar } from "./claude";
import { LongRangeLeaseError, longRangeMarketKey, type Lead, type LongRangeState, type LongRangeStore } from "../long-range-store";

const now = new Date("2026-09-05T12:00:00Z");
const input = { pageFetcher: false as const, start: "2026-12-05", end: "2027-12-31", location: "Eindhoven", radiusKm: 25, now, model: "claude-sonnet-5" };
const url = "https://organizer.example/future";
const event = (overrides = {}) => ({
  sourceUrl: url, title: "Annual Arts Week", category: "culture", venue: "City venue", latitude: 51.44, longitude: 5.48,
  regionScope: null, startAt: "2027-05-21T10:00:00Z", endAt: "2027-05-23T20:00:00Z", status: "active", ownerType: "organizer",
  evidenceText: "Future edition: 21-23 May 2027 at City venue", attendance: null, venueCapacity: null, impactPoints: null,
  overnightAudience: null, titleConfirmed: true, dateConfirmed: true, locationConfirmed: true, ...overrides,
});
const response = (events: ReturnType<typeof event>[] = []) => ({
  stop_reason: "end_turn",
  content: [{ type: "web_fetch_tool_result", content: { type: "web_fetch_result", url } }, { type: "text", text: JSON.stringify({ events, reason: events.length ? "Announced" : "No published future dates" }) }],
  usage: { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: 0, web_fetch_requests: 1 } },
});
const resolution = (target: string | null) => ({
  stop_reason: "end_turn",
  content: [{ type: "web_search_tool_result", content: target ? [{ url: target }] : [] }, { type: "text", text: JSON.stringify({ url: target, reason: target ? "Official page resolved" : "No official future announcement found" }) }],
  usage: { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } },
});
const lead = (overrides: Partial<Lead> = {}): Lead => ({ key: "arts", title: "Annual Arts Week", url, kind: "event", group: 1, attempts: 0, nextCheck: now.toISOString(), checkedAt: null, outcome: "pending", editions: [], notes: [], ...overrides });
function memoryStore(initial: LongRangeState | null) {
  let state = initial;
  let acquired = false;
  const store: LongRangeStore = {
    acquire: async () => { if (acquired) return false; acquired = true; return true; },
    release: async () => { acquired = false; },
    load: async () => state ? structuredClone(state) : null,
    save: vi.fn(async (_key, value) => { state = structuredClone(value); }),
  };
  return { store, state: () => state! };
}
const warmState = (leads = [lead()], overrides: Partial<LongRangeState> = {}): LongRangeState => ({ version: 2003, discoveredAt: now.toISOString(), leads, ...overrides });
const client = (create: ReturnType<typeof vi.fn>) => ({ messages: { create } }) as unknown as Anthropic;
const toolNames = (call: { tools: { name: string }[] }[]) => call[0].tools.map((tool) => tool.name);

describe("long-range source leads", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("shares the eight follow-up slots between exploration and explicit evidence fetches", async () => {
    const about = "https://organizer.example/about";
    const create = vi.fn().mockImplementation(async (request) => {
      const prompt = request.messages[0].content[1].text;
      if (prompt.includes("Call web_fetch on it now")) return { ...response([event({ sourceUrl: about })]), content: [
        { type: "web_fetch_tool_result", content: { type: "web_fetch_result", url: about } },
        { type: "text", text: JSON.stringify({ events: [event({ sourceUrl: about })], reason: "Fetched evidence" }) },
      ] };
      if (prompt.includes("Then read a SECOND page")) return { ...response(), content: [
        { type: "web_fetch_tool_result", content: { type: "web_fetch_result", url } },
        { type: "web_search_tool_result", content: [{ url: about }] },
        { type: "text", text: JSON.stringify({ events: [event({ sourceUrl: about })], reason: "Cited but not fetched" }) },
      ] };
      return response();
    });
    const memory = memoryStore(warmState(Array.from({ length: 9 }, (_, index) => lead({ key: `lead-${index}`, title: `Series ${index}` })),
      { lastSweepAt: "2026-08-01T00:00:00Z" }));
    const result = await collectLongRange({ ...input, store: memory.store, client: client(create) });
    expect(result.usage.deepRequests + result.usage.evidenceRequests).toBe(8);
    expect(result.usage.evidenceRequests).toBe(4);
    expect(result.requests).toBe(17);
  });

  it("uses a known edition as an internal announcement target before it ends, without publishing the estimate", async () => {
    const memory = memoryStore(warmState([]));
    const create = vi.fn().mockResolvedValue(response());
    const seeds = [{ title: "Annual Arts Week", url, lastEditionStart: "2026-10-17", lastEditionEnd: "2026-10-25" }];
    const result = await collectLongRange({ ...input, seeds, store: memory.store, client: client(create) });
    expect(result.candidates).toEqual([]);
    expect(memory.state().leads[0].projections?.[0]).toMatchObject({ start: "2027-10-17", end: "2027-10-25", status: "projected" });
    expect(JSON.stringify(create.mock.calls[0][0].messages)).toContain("edition year(s) 2027");
    expect(JSON.stringify(create.mock.calls[0][0].messages)).not.toContain("2027-10-17");
    expect((await collectLongRange({ ...input, seeds, store: memory.store, client: client(create) })).requests).toBe(0);
  });

  it("keeps the successful detail page sticky across seeds, refreshes and a later fetch failure", async () => {
    const about = "https://organizer.example/about";
    const edition = event({ sourceUrl: about });
    const confirmed = { ...response([edition]), content: [
      { type: "web_fetch_tool_result", content: { type: "web_fetch_result", url: about } },
      { type: "text", text: JSON.stringify({ events: [edition], reason: "Official future dates" }) },
    ] };
    const memory = memoryStore(warmState());
    const create = vi.fn().mockResolvedValueOnce(confirmed).mockResolvedValue({
      ...response(), content: [{ type: "text", text: JSON.stringify({ events: [], reason: "Fetch failed" }) }],
    });
    await collectLongRange({ ...input, store: memory.store, client: client(create) });
    const seeds = [{ title: "Annual Arts Week", url, lastEditionStart: "2027-05-21", lastEditionEnd: "2027-05-23" }];
    const later = new Date("2026-12-05T12:00:00Z");
    memory.state().discoveredAt = later.toISOString();
    await collectLongRange({ ...input, now: later, seeds, store: memory.store, client: client(create) });
    expect(JSON.stringify(create.mock.calls[1][0].messages)).toContain(`First fetch this observed official source: ${about}`);
    expect(memory.state().leads[0]).toMatchObject({ officialPage: about, url: about, outcome: "failed" });
    expect((await collectLongRange({ ...input, now: later, seeds, store: memory.store, client: client(create) })).requests).toBe(0);
    // Also recover rows whose target was cleared by the old implementation.
    memory.state().leads[0].url = null;
    const nextDue = new Date(memory.state().leads[0].nextCheck);
    memory.state().discoveredAt = nextDue.toISOString();
    create.mockResolvedValue(confirmed);
    const refreshed = await collectLongRange({ ...input, now: nextDue, seeds, store: memory.store, client: client(create) });
    expect(refreshed.usage.resolveRequests ?? 0).toBe(0);
    expect(JSON.stringify(create.mock.calls.at(-1)![0].messages)).toContain(`First fetch this observed official source: ${about}`);
    expect(memory.state().leads[0]).toMatchObject({ officialPage: about, url: about, outcome: "confirmed" });
  });

  it.each(["", "  \n"])("falls back from blank optional model settings (%j)", async (blank) => {
    vi.stubEnv("ANTHROPIC_DISCOVERY_MODEL", blank);
    vi.stubEnv("ANTHROPIC_TRIAGE_MODEL", blank);
    const create = vi.fn().mockResolvedValue({
      stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ leads: [] }) }],
      usage: { input_tokens: 0, output_tokens: 0, server_tool_use: { web_search_requests: 1 } },
    });
    const result = await collectLongRange({ ...input, discoveryModel: blank, store: memoryStore(null).store, client: client(create) });
    expect(result.usage.completedSearches).toBe(10);
    expect(create).toHaveBeenCalledTimes(10);
    expect(create.mock.calls.every(([request]) => request.model === input.model)).toBe(true);

    create.mockReset().mockResolvedValueOnce(resolution(url)).mockResolvedValue(response([event()]));
    await collectLongRange({ ...input, resolutionModel: blank, store: memoryStore(warmState([lead({ url: null })])).store, client: client(create) });
    expect(create.mock.calls[0][0].model).toBe("claude-haiku-4-5-20251001");
    expect(create.mock.calls[1][0].model).toBe(input.model);
  });

  it("rejects a blank main model before sending requests", async () => {
    vi.stubEnv("ANTHROPIC_MODEL", "  ");
    const create = vi.fn();
    await expect(collectLongRange({ ...input, model: "", store: memoryStore(null).store, client: client(create) })).rejects.toThrow("ANTHROPIC_MODEL is required");
    expect(create).not.toHaveBeenCalled();
  });

  it("waits until a seeded edition finishes and does not re-fetch it on immediate repeats", async () => {
    const create = vi.fn().mockResolvedValue(response());
    const memory = memoryStore(warmState([], { lastSweepAt: now.toISOString() }));
    const seeds = [{ title: "Annual Arts Week", url, lastEditionEnd: "2026-09-10" }];
    const run = (at: Date) => collectLongRange({ ...input, now: at, seeds, store: memory.store, client: client(create) });
    expect((await run(now)).requests).toBe(0);
    expect((await run(now)).requests).toBe(0);
    expect((await run(new Date("2026-09-10T23:59:59Z"))).requests).toBe(0);
    expect((await run(new Date("2026-09-11T00:00:00Z"))).requests).toBe(2);
    expect((await run(new Date("2026-09-11T00:01:00Z"))).requests).toBe(0);
  });

  it("keeps unchanged same-year editions and accepts an additional edition alongside one already known", async () => {
    const may = event();
    const august = event({ startAt: "2027-08-07", endAt: "2027-08-07" });
    const create = vi.fn().mockResolvedValueOnce(response([may])).mockResolvedValue(response([may, august]));
    const memory = memoryStore(warmState());
    const run = (at: Date) => collectLongRange({ ...input, now: at, store: memory.store, client: client(create) });
    await run(now);
    for (const at of ["2026-12-05T12:00:00Z", "2027-03-06T12:00:00Z"]) {
      memory.state().discoveredAt = at;
      const result = await run(new Date(at));
      expect(result.candidates).toHaveLength(2);
      expect(result.quarantinedProviderEventIds).toEqual([]);
      expect(memory.state().leads[0].outcome).toBe("confirmed");
    }
  });

  it("preserves both pieces of evidence for an end-date-only conflict", async () => {
    const create = vi.fn().mockResolvedValueOnce(response([event()])).mockResolvedValue(response([event({ endAt: "2027-05-24" })]));
    const memory = memoryStore(warmState());
    await collectLongRange({ ...input, store: memory.store, client: client(create) });
    memory.state().discoveredAt = "2026-12-05T12:00:00Z";
    const result = await collectLongRange({ ...input, now: new Date("2026-12-05T12:00:00Z"), store: memory.store, client: client(create) });
    expect(result.candidates).toEqual([]);
    expect(memory.state().leads[0].editions.map((item) => item.endAt.slice(0, 10))).toEqual(["2027-05-23", "2027-05-24"]);
  });

  it("allows only one market sweep at a time and reuses its result after release", async () => {
    let finish!: (value: ReturnType<typeof response>) => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const create = vi.fn().mockImplementation(() => { started(); return new Promise((resolve) => { finish = resolve; }); });
    const memory = memoryStore(warmState());
    const run = () => collectLongRange({ ...input, store: memory.store, client: client(create) });
    const first = run();
    await entered;
    await expect(run()).rejects.toBeInstanceOf(LongRangeLeaseError);
    expect(create).toHaveBeenCalledTimes(1);
    finish(response([event()]));
    await first;
    expect((await run()).requests).toBe(0);
  });

  it("releases a market after a persistence failure so the queue can resume", async () => {
    const memory = memoryStore(warmState());
    const create = vi.fn().mockResolvedValue(response([event()]));
    vi.mocked(memory.store.save).mockRejectedValueOnce(new Error("Save failed"));
    const run = () => collectLongRange({ ...input, store: memory.store, client: client(create) });
    await expect(run()).rejects.toThrow("Save failed");
    await expect(run()).resolves.toMatchObject({ source: "claude" });
  });

  it("bootstraps ten searches, rejects aggregator URLs and resolves them off the main model", async () => {
    const create = vi.fn();
    for (let i = 0; i < 10; i++) create.mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [{ type: "web_search_tool_result", content: [{ url: "https://en.wikipedia.org/wiki/Arts_Week" }] },
        { type: "text", text: JSON.stringify({ leads: i === 0 ? [{ title: "Annual Arts Week 2026", url: "https://en.wikipedia.org/wiki/Arts_Week", kind: "event" }] : [] }) }],
      usage: { input_tokens: 50, output_tokens: 10, server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } },
    });
    create.mockResolvedValueOnce(resolution(url)).mockResolvedValue(response([event()]));
    const memory = memoryStore(null);
    const result = await collectLongRange({ ...input, store: memory.store, client: client(create) });
    expect(result.usage.completedSearches).toBe(10);
    // The Wikipedia hit is a name, never a fetch target, so the lead arrives without a URL.
    expect(toolNames(create.mock.calls[10])).toContain("web_search");
    expect(create.mock.calls[10][0].model).not.toBe("claude-sonnet-5");
    expect(result.candidates[0]).toMatchObject({ title: "Annual Arts Week", aiImpactPoints: null, primarySourceConfirmed: true });
    expect(memory.state().leads[0].url).toBe(url);
    const discoveryPrompts = create.mock.calls.slice(0, 10).map(([request]) => request.messages[0].content).join(" ");
    expect(discoveryPrompts).not.toContain("Annual Arts Week");
  });

  it("resolves a missing URL before verification, retains dates without demand, and reuses them for another hotel", async () => {
    const create = vi.fn().mockResolvedValueOnce(resolution(url)).mockResolvedValueOnce(response([event()]));
    const memory = memoryStore(warmState([lead({ url: null })]));
    const result = await collectLongRange({ ...input, store: memory.store, client: client(create) });
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.usage).toMatchObject({ datesConfirmed: 1, demandAccepted: 0 });
    expect(memory.state().leads[0].nextCheck).toBe("2026-12-04T12:00:00.000Z");
    const warm = await collectLongRange({ ...input, location: " eindhoven ", store: memory.store, client: client(create) });
    expect(warm.requests).toBe(0);
    expect(warm.usage.inputTokens).toBe(0);
    expect(warm.candidates).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("reads a second page instead of re-resolving the URL when the first page shows no dates", async () => {
    const create = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce(response([event()]));
    const memory = memoryStore(warmState());
    const result = await collectLongRange({ ...input, store: memory.store, client: client(create) });
    expect(create).toHaveBeenCalledTimes(2);
    // Round B stays a fetch on the lead's own host; the search tool only makes that page reachable.
    expect(toolNames(create.mock.calls[1])[0]).toBe("web_fetch");
    expect(create.mock.calls[1][0].model).toBe("claude-sonnet-5");
    expect(create.mock.calls[1][0].messages[0].content[1].text).toContain("Then read a SECOND page on organizer.example");
    expect(result.candidates).toHaveLength(1);
    expect(memory.state().leads[0].attempts).toBe(2);
  });

  it("resolves a lead, reads its current edition, then confirms a future edition on a deeper page", async () => {
    const create = vi.fn().mockResolvedValueOnce(resolution(url))
      .mockResolvedValueOnce(response([event({ startAt: "2026-05-21", endAt: "2026-05-23" })]))
      .mockResolvedValueOnce(response([event()]));
    const memory = memoryStore(warmState([lead({ url: null })]));
    const result = await collectLongRange({ ...input, store: memory.store, client: client(create) });
    expect(create).toHaveBeenCalledTimes(3);
    expect(result.usage).toMatchObject({ resolveRequests: 1, fetchRequests: 1, deepRequests: 1, datesConfirmed: 1 });
    expect(create.mock.calls[2][0].messages[0].content[1].text).toContain("Then read a SECOND page");
    expect(memory.state().leads[0].outcome).toBe("confirmed");
    expect((await collectLongRange({ ...input, store: memory.store, client: client(create) })).requests).toBe(0);
  });

  it("shares the existing deeper-page cap with newly resolved leads using their original queue priority", async () => {
    const known = Array.from({ length: 9 }, (_, i) => lead({ key: `known-${i}`, title: `Known ${i}`, url: `https://organizer.example/${i}`, attempts: 3 }));
    const fresh = lead({ key: "new", title: "New Arts Week", url: null });
    const create = vi.fn().mockImplementation((request) => Promise.resolve(
      request.tools[0].name === "web_search" ? resolution(url) : response(),
    ));
    const memory = memoryStore(warmState([...known, fresh], { lastSweepAt: "2026-08-01T12:00:00Z" }));
    const result = await collectLongRange({ ...input, store: memory.store, client: client(create) });
    expect(result.usage).toMatchObject({ resolveRequests: 1, fetchRequests: 10, deepRequests: 8 });
    expect(create).toHaveBeenCalledTimes(19);
    const deep = create.mock.calls.filter(([request]) => request.messages[0].content[1]?.text?.includes("Then read a SECOND page"));
    expect(deep).toHaveLength(8);
    expect(deep[0][0].messages[0].content[1].text).toContain("New Arts Week");
    expect(memory.state().leads.every((item) => item.checkedAt === now.toISOString())).toBe(true);
  });

  it("sends a calendar hub one level deeper even after it produced editions", async () => {
    const detail = event({ title: "Masters championship", startAt: "2027-05-06T00:00:00Z", endAt: "2027-05-09T00:00:00Z" });
    const create = vi.fn().mockResolvedValueOnce(response([event()])).mockResolvedValueOnce(response([detail]));
    const memory = memoryStore(warmState([lead({ kind: "calendar" })]));
    const result = await collectLongRange({ ...input, store: memory.store, client: client(create) });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].messages[0].content[1].text).toContain("whose date, year or host city was incomplete");
    expect(result.candidates.map((item) => item.title).sort()).toEqual(["Annual Arts Week", "Masters championship"]);
    expect(memory.state().leads[0].outcome).toBe("confirmed");
  });

  it("caches the shared instruction prefix and keeps the lead-specific text last", async () => {
    const create = vi.fn().mockResolvedValue(response([event()]));
    const memory = memoryStore(warmState([lead(), lead({ key: "other", title: "Other Week", url: "https://other.example/x" })]));
    await collectLongRange({ ...input, store: memory.store, client: client(create) });
    const [first, second] = create.mock.calls.map(([request]) => request.messages[0].content);
    expect(first[0]).toMatchObject({ cache_control: { type: "ephemeral" } });
    expect(first[0].text).toBe(second[0].text);
    expect(first[1].text).toContain("Annual Arts Week");
    expect(first[1].cache_control).toBeUndefined();
  });

  it("stops after one round when the fetch itself failed and retains the failure", async () => {
    const create = vi.fn().mockResolvedValue({ ...response(), stop_reason: "max_tokens" });
    const memory = memoryStore(warmState());
    const result = await collectLongRange({ ...input, store: memory.store, client: client(create) });
    expect(result.error).toContain("Incomplete response: max_tokens");
    expect(result.usage.inputTokens).toBe(100);
    expect(create).toHaveBeenCalledTimes(1);
    expect(memory.state().leads[0].outcome).toBe("failed");
  });

  it("accepts multiple dated federation entries but rejects unconfirmed evidence and out-of-window dates", async () => {
    const create = vi.fn().mockResolvedValue(response([
      event({ title: "First tournament", ownerType: "federation" }),
      event({ title: "Second tournament", ownerType: "federation", startAt: "2027-08-01", endAt: "2027-08-03" }),
      event({ title: "Unannounced", dateConfirmed: false }),
      event({ title: "Wrong source", sourceUrl: "https://invented.example" }),
      event({ title: "Old edition", startAt: "2026-05-01", endAt: "2026-05-03" }),
      event({ title: "Aggregator", ownerType: "other" }),
    ]));
    const memory = memoryStore(warmState([lead({ kind: "calendar" })]));
    const result = await collectLongRange({ ...input, store: memory.store, client: client(create) });
    expect(result.candidates.map((item) => item.title)).toEqual(["First tournament", "Second tournament"]);
  });

  it("preserves conflicting announced dates and withholds the editions", async () => {
    const create = vi.fn().mockResolvedValueOnce(response([event()])).mockResolvedValueOnce(response([event({ startAt: "2027-05-22" })]));
    const memory = memoryStore(warmState());
    await collectLongRange({ ...input, store: memory.store, client: client(create) });
    // A confirmed lead waits 90 days, so the refresh has to happen after that and outside the
    // monthly discovery window to isolate the scheduled source refresh.
    memory.state().discoveredAt = "2026-12-01T12:00:00Z";
    const changed = await collectLongRange({ ...input, now: new Date("2026-12-10T12:00:00Z"), store: memory.store, client: client(create) });
    expect(memory.state().leads[0].outcome).toBe("conflict");
    expect(memory.state().leads[0].editions).toHaveLength(2);
    expect(changed.candidates).toEqual([]);
    expect(changed.error).toContain("Conflicting dates");
  });

  it("checks a lead weekly inside its announcement window and monthly outside it", () => {
    const anchored = (days: number) => nextCheckAt(lead({ anchor: new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10) }), now);
    expect(anchored(30)).toBe("2026-09-12T12:00:00.000Z");
    expect(anchored(200)).toBe("2026-10-03T12:00:00.000Z");
    expect(anchored(-10)).toBe("2026-10-03T12:00:00.000Z");
    expect(nextCheckAt(lead({ outcome: "confirmed", anchor: "2026-08-06" }), now)).toBe("2026-12-04T12:00:00.000Z");
    expect(nextCheckAt(lead({ kind: "calendar", anchor: "2026-08-06" }), now)).toBe("2026-10-03T12:00:00.000Z");
  });

  it("reserves resolve slots so a URL-less lead is never starved by repeatedly fetched ones", () => {
    const leads = [
      ...Array.from({ length: 30 }, (_, i) => lead({ key: `event-${i}`, attempts: 5, nextCheck: new Date(now.getTime() - i * 1000).toISOString() })),
      ...Array.from({ length: 12 }, (_, i) => lead({ key: `calendar-${i}`, kind: "calendar" })),
      lead({ key: "portfolio", origin: "portfolio", attempts: 9 }),
      ...Array.from({ length: 20 }, (_, i) => lead({ key: `nourl-${i}`, url: null })),
      lead({ key: "fresh", attempts: 0 }),
    ];
    const selected = selectDueLeads(leads, now, false);
    expect(selected).toHaveLength(18);
    expect(selected.every((item) => item.url)).toBe(true);
    expect(selected.filter((item) => item.kind === "calendar")).toHaveLength(6);
    expect(selected.find((item) => item.kind !== "calendar")!.key).toBe("portfolio");
    // A lead nobody has looked at outranks one already fetched five times.
    expect(selected.map((item) => item.key)).toContain("fresh");
    expect(selectDueLeads(leads, now, true)).toHaveLength(36);
    const resolving = selectResolveLeads(leads, now, false);
    expect(resolving).toHaveLength(6);
    expect(resolving.every((item) => !item.url)).toBe(true);
    expect(selectResolveLeads(leads, now, true)).toHaveLength(12);
    expect(longRangeMarketKey(" Eindhoven ", 25)).toBe(longRangeMarketKey("eindhoven", 25));
    expect(longRangeMarketKey("Eindhoven", 30)).not.toBe(longRangeMarketKey("Eindhoven", 25));
  });

  it("drops a URL the fetcher cannot read so the resolver can replace it", async () => {
    const blocked = { ...response(), content: [
      { type: "server_tool_use", id: "fetch-1", name: "web_fetch", input: { url } },
      { type: "web_fetch_tool_result", tool_use_id: "fetch-1", content: { type: "web_fetch_tool_result_error", error_code: "url_not_allowed" } },
      { type: "text", text: JSON.stringify({ events: [], reason: "Fetch rejected" }) },
    ] };
    const create = vi.fn().mockResolvedValue(blocked);
    const memory = memoryStore(warmState([lead({ officialPage: url })]));
    const result = await collectLongRange({ ...input, store: memory.store, client: client(create) });
    expect(result.error).toContain("No fetched official page");
    expect(create).toHaveBeenCalledTimes(1);
    expect(memory.state().leads[0]).toMatchObject({ outcome: "failed", url: null, officialPage: url, blockedPage: url });
    const nextDue = new Date(memory.state().leads[0].nextCheck);
    expect(selectDueLeads(memory.state().leads, nextDue, false)).toEqual([]);
    expect(selectResolveLeads(memory.state().leads, nextDue, false)).toHaveLength(1);
    memory.state().discoveredAt = nextDue.toISOString();
    create.mockResolvedValue(resolution(url));
    await collectLongRange({ ...input, now: nextDue, store: memory.store, client: client(create) });
    expect(create).toHaveBeenCalledTimes(2);
    expect(memory.state().leads[0].url).toBeNull();
  });

  it("does not treat a model's textual claim of a blocked URL as a tool rejection", async () => {
    const create = vi.fn().mockResolvedValue({ ...response(), content: [
      { type: "text", text: JSON.stringify({ events: [], reason: "url_not_allowed" }) },
    ] });
    const memory = memoryStore(warmState([lead({ officialPage: url })]));
    await collectLongRange({ ...input, store: memory.store, client: client(create) });
    expect(memory.state().leads[0]).toMatchObject({ url, officialPage: url });
    expect(memory.state().leads[0].blockedPage).toBeUndefined();
  });

  it("keeps the experimental future collector disabled and schedules near-term independently when enabled", async () => {
    const collect = vi.fn().mockResolvedValue({ source: "claude", candidates: [], requests: 0, usage: {} });
    const future = vi.fn().mockResolvedValue({ source: "claude", candidates: [], requests: 0, usage: {} });
    await collectClaudeCalendar({ ...input, longRangeEnabled: false }, collect, future);
    expect(future).not.toHaveBeenCalled();
    const seeds = [{ title: "Annual Arts Week", url, lastEditionEnd: "2026-09-01" }];
    const result = await collectClaudeCalendar({ ...input, longRangeSeeds: seeds, longRangeEnabled: true, runNearTerm: false }, collect, future);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(future).toHaveBeenCalledTimes(1);
    expect(future.mock.calls[0][0].seeds).toEqual(seeds);
    expect(result.usage.nearTermSkipped).toBe(1);
  });

  it("retains valid discoveries when another result has an invalid kind", async () => {
    const create = vi.fn();
    for (let i = 0; i < 10; i++) create.mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [{ type: "web_search_tool_result", content: [{ url }] },
        { type: "text", text: JSON.stringify({ leads: i === 0 ? [
          { title: "Invalid entry", url, kind: "unknown" },
          { title: "Annual Arts Week", url, kind: "event" },
        ] : [] }) }],
      usage: { input_tokens: 50, output_tokens: 10, server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } },
    });
    create.mockResolvedValue(response([event()]));
    const memory = memoryStore(null);
    const result = await collectLongRange({ ...input, store: memory.store, client: client(create) });
    expect(result.candidates).toHaveLength(1);
    expect(memory.state().leads.map((item) => item.title)).toEqual(["Annual Arts Week"]);
    expect(result.funnel?.drops.some((drop) => drop.reason.includes("Invalid individual lead"))).toBe(true);
  });

  it("preserves a confirmed edition through a failed refresh and keeps its series after completion", async () => {
    const create = vi.fn().mockResolvedValueOnce(response([event()]));
    const memory = memoryStore(warmState());
    await collectLongRange({ ...input, store: memory.store, client: client(create) });
    memory.state().discoveredAt = "2026-12-01T12:00:00Z";
    create.mockRejectedValue(new Error("Temporary fetch failure"));
    const failed = await collectLongRange({ ...input, now: new Date("2026-12-10T12:00:00Z"), store: memory.store, client: client(create) });
    expect(failed.candidates).toHaveLength(1);
    expect(failed.error).toContain("Temporary fetch failure");
    memory.state().discoveredAt = "2027-06-01T12:00:00Z";
    create.mockResolvedValue(response());
    const completed = await collectLongRange({ ...input, start: "2027-09-01", end: "2028-12-31", now: new Date("2027-06-01T12:00:00Z"), store: memory.store, client: client(create) });
    expect(completed.candidates).toEqual([]);
    expect(memory.state().leads).toHaveLength(1);
    expect(memory.state().leads[0].editions).toHaveLength(1);
  });

  it("makes no requests between sweeps unless an edition just ended", async () => {
    const create = vi.fn().mockResolvedValue(response([event()]));
    const swept = warmState([lead({ origin: "portfolio", anchor: "2026-09-06", nextCheck: "2026-10-01T12:00:00Z" })],
      { lastSweepAt: now.toISOString(), lastPassAt: now.toISOString() });
    const memory = memoryStore(swept);
    const quiet = await collectLongRange({ ...input, now: new Date("2026-09-08T12:00:00Z"), store: memory.store, client: client(create) });
    expect(quiet.requests).toBe(0);
    expect(create).not.toHaveBeenCalled();
    const seeded = await collectLongRange({ ...input, now: new Date("2026-09-08T12:00:00Z"), store: memory.store, client: client(create),
      seeds: [{ title: "Annual Arts Week", url, lastEditionEnd: "2026-09-06" }] });
    expect(seeded.requests).toBe(1);
    expect(toolNames(create.mock.calls[0])).toEqual(["web_fetch"]);
    expect(memory.state().lastSweepAt).toBe(now.toISOString());
  });

  it("re-opens a seeded lead only when it has not been checked since the edition ended", async () => {
    const create = vi.fn().mockResolvedValue(response([event()]));
    const checked = (checkedAt: string) => memoryStore(warmState(
      [lead({ origin: "portfolio", anchor: "2026-09-01", checkedAt, nextCheck: "2026-10-01T12:00:00Z" })],
      { lastSweepAt: now.toISOString(), lastPassAt: now.toISOString() },
    ));
    const seeds = [{ title: "Annual Arts Week", url, lastEditionEnd: "2026-09-06" }];
    const at = new Date("2026-09-08T12:00:00Z");
    const stale = checked("2026-09-05T12:00:00Z");
    expect((await collectLongRange({ ...input, now: at, store: stale.store, client: client(create), seeds })).requests).toBe(1);
    const fresh = checked("2026-09-07T12:00:00Z");
    expect((await collectLongRange({ ...input, now: at, store: fresh.store, client: client(create), seeds })).requests).toBe(0);
  });

  it("recovers a result URL the model appended a JSON field to, and invents none", () => {
    const observed = ["https://mge.nl/", "https://mge.nl/bridge/", "https://mikrocentrum.nl/en/events/calendar/"];
    // Observed verbatim in the 2026-09-05 benchmark: the reason field was glued onto the URL.
    expect(repairObservedUrl("https://mge.nl/bridge/reason", observed)).toBe("https://mge.nl/bridge/");
    expect(repairObservedUrl("https://mikrocentrum.nl/en/events/calendar/',ALEN,ENABLED,));", observed)).toBe("https://mikrocentrum.nl/en/events/calendar/");
    expect(repairObservedUrl("https://mge.nl/bridge/", observed)).toBe("https://mge.nl/bridge/");
    expect(repairObservedUrl("https://invented.example/2027", observed)).toBeNull();
    expect(repairObservedUrl(null, observed)).toBeNull();
  });

  it("only fetches URLs whose host can own the dates", () => {
    expect(isAggregatorUrl("https://www.thisiseindhoven.com/nl/agenda")).toBe(true);
    expect(isAggregatorUrl("https://nl.wikipedia.org/wiki/GLOW")).toBe(true);
    expect(isAggregatorUrl("not a url")).toBe(true);
    expect(isAggregatorUrl("https://site.ddw.nl/nl/over-ddw")).toBe(false);
    expect(isAggregatorUrl("https://www.knzb.nl/nieuws/x")).toBe(false);
    expect(isAggregatorUrl("https://dynamo-metalfest.nl/first-names-dmf-27/")).toBe(false);
  });

  it("drops the most-attempted unannounced leads first and never drops stored editions", () => {
    const leads = [
      lead({ key: "held", outcome: "unannounced", attempts: 9, editions: [{ title: "kept" } as never] }),
      lead({ key: "owned", outcome: "unannounced", attempts: 9, origin: "portfolio" }),
      ...Array.from({ length: 81 }, (_, i) => lead({ key: `cold-${i}`, outcome: "unannounced", attempts: i, checkedAt: "2026-09-01T12:00:00Z" })),
    ];
    const dropped = pruneLeads(leads);
    expect(dropped.map((item) => item.key)).toEqual(["cold-80", "cold-79", "cold-78"]);
    expect(leads).toHaveLength(80);
    expect(leads.map((item) => item.key)).toContain("held");
    expect(leads.map((item) => item.key)).toContain("owned");
  });
});

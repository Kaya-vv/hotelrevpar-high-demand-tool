import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { createHash } from "node:crypto";
import type { EventCandidate } from "@/features/events/types";
import { normalizeText } from "@/features/events/normalize";
import type { CollectionWindow, SourceResult } from "../types";
import { CLAUDE_ASSESSMENT_VERSION } from "../anthropic-batches";
import { createLongRangeStore, LONG_RANGE_VERSION, LongRangeLeaseError, longRangeMarketKey, type Lead, type LongRangeSeed, type LongRangeStore } from "../long-range-store";
import { claudeProviderEventId, DEFAULT_TRIAGE_MODEL, fetchedUrls, geocodeVenue, observedUrl, outputSchema, requestMessages, sourceUrls, usageEvent, type Batching, type ClaudeUsageEvent } from "./claude";

const groups = [
  { topic: "vakbeurzen congressen conferenties", futureTopic: "trade fairs conferences", focus: "business and scientific conferences, trade fairs and industry conventions" },
  { topic: "design kunst cultuur evenementen", futureTopic: "design culture events", focus: "citywide design, art, architecture, fashion and cultural weeks or biennials" },
  { topic: "jaarlijkse festivals", futureTopic: "festivals", focus: "multi-day music festivals and major entertainment festivals with travelling audiences" },
  { topic: "sportevenementen toernooien kampioenschappen", futureTopic: "kampioenschappen kalender", focus: "national and international championships, participant tournaments and mass-participation sport; include indoor and aquatic sport as well as outdoor sport" },
  // The ONMK masters and Dynamo Metalfest were never named by an event-name search; both sit on a
  // forward venue or federation calendar, which is also how the trial's only two clean
  // confirmations were reached. The two queries split the group: halls, then federations.
  { topic: "concertzaal evenementenhal poppodium agenda", futureTopic: "sportbond nationale kampioenschappen kalender", focus: "large venues, halls, expo centres and stadiums near the city that publish a forward event agenda, plus national sport federations and clubs that publish a competition calendar naming this city" },
] as const;
const leadSchema = z.object({ title: z.string(), url: z.url().nullable(), kind: z.enum(["event", "calendar", "organizer", "venue", "federation"]) });
const discoverySchema = z.object({ leads: z.array(leadSchema).max(8) });
const editionSchema = z.object({ events: z.array(outputSchema.shape.events.element).max(8), reason: z.string() });
const resolutionSchema = z.object({ url: z.url().nullable(), reason: z.string() });
const day = 86_400_000;
const later = (now: Date, days: number) => new Date(now.getTime() + days * day).toISOString();
const labelKey = (title: string) => normalizeText(title.replace(/\([^)]*\)/g, "")).replace(/\b20\d{2}\b/g, "").trim();
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
/** The model answered but no page was retrieved — a blocked host, not a transport failure. */
const NO_PAGE = "No fetched official page";

const FETCH_SLOTS = 18;    // leads fetched per 28-day sweep
const CALENDAR_SLOTS = 6;  // reserved inside FETCH_SLOTS for calendar hubs
const RESOLVE_SLOTS = 6;   // URL lookups per sweep
const DEEP_SLOTS = 8;      // second-page fetches per sweep
const SEED_SLOTS = 4;      // just-ended editions checked between sweeps
const LEAD_CAP = 80;
const SWEEP_DAYS = 28;

// A lead URL only earns a fetch when it can own the event's dates. Aggregators, wikis and tourist
// listings republish them, so a fetch there confirms nothing. Extend this list when a new host
// shows up in the verification drops.
const AGGREGATOR_DOMAINS = [
  "wikipedia.org", "wikiwand.com", "songkick.com", "bandsintown.com", "eventbrite.com",
  "eventbrite.nl", "ticketmaster.nl", "ticketmaster.com", "eventim.nl", "seetickets.com",
  "paylogic.com", "festivalinfo.nl", "partyflock.nl", "residentadvisor.net", "ra.co",
  "facebook.com", "instagram.com", "x.com", "twitter.com", "youtube.com", "tiktok.com",
  "tripadvisor.nl", "tripadvisor.com", "google.com", "bing.com", "reddit.com", "linkedin.com",
  "meetup.com", "allevents.in", "eventful.com", "10times.com", "holland.com", "visitbrabant.com",
  "thisiseindhoven.com", "iamsterdam.com", "eindhoven365.nl", "uitagendaeindhoven.nl",
  // Observed above the event owners in the 2026-09-05 benchmark's search results.
  "concerts-metal.com", "awayfromlife.com", "uiteindhoven.com", "followthebeat.nl", "99festivals.com",
  "ahotu.com", "running.life", "atleta.cc", "dejawuguitars.com", "dansendeberen.be", "theheavyhunt.nl",
  "plons.nu", "voetbalkrant.com", "soccerway.com", "espn.com", "eventseye.com", "dezeen.com",
] as const;

export function isAggregatorUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return AGGREGATOR_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch { return true; }
}

/**
 * The model repeatedly returned a real result URL with the next JSON field glued onto it —
 * `https://mge.nl/bridge/reason`, `https://mikrocentrum.nl/en/events/calendar/',ALEN,ENABLED,));`,
 * a bare trailing dot — and the observation check then threw the lead away. The repaired value is
 * still always a URL the search returned, so nothing invented can reach a fetch.
 */
export function repairObservedUrl(value: string | null, observed: string[]) {
  if (!value) return null;
  if (observedUrl(value, observed)) return new URL(value).href;
  let repaired: string | null = null;
  for (const candidate of observed) {
    if (value.startsWith(candidate) && (!repaired || candidate.length > repaired.length)) repaired = candidate;
  }
  return repaired;
}

export type LongRangeInput = CollectionWindow & {
  location: string;
  radiusKm: number;
  now?: Date;
  model?: string;
  discoveryModel?: string;
  resolutionModel?: string;
  seeds?: LongRangeSeed[];
  client?: Anthropic;
  batching?: Batching;
  store?: LongRangeStore;
  onUsage?: (event: ClaudeUsageEvent) => void | Promise<void>;
  geocode?: typeof geocodeVenue;
};

/**
 * Organisers publish next year's dates in a narrow window right after the current edition ends, so
 * a lead is chased weekly inside that window and left to the monthly sweep outside it.
 */
export function nextCheckAt(lead: Lead, now: Date): string {
  if (lead.outcome === "confirmed") return later(now, 90);
  // Four fruitless requests is two sweeps of evidence that this page does not publish dates; city
  // culture portals were consuming a fetch slot a month and confirming nothing.
  if (lead.outcome === "unannounced" && (lead.attempts ?? 0) >= 4) return later(now, 90);
  if (lead.kind === "calendar") return later(now, SWEEP_DAYS);
  if (!lead.anchor) return later(now, SWEEP_DAYS);
  const since = Math.floor((now.getTime() - Date.parse(`${lead.anchor}T00:00:00Z`)) / day);
  // Days since the most recent anniversary of the last edition's end. Negative `since`
  // (edition still running) wraps to the far end and is deliberately not chased.
  const cycle = ((since % 365) + 365) % 365;
  return later(now, cycle <= 60 ? 7 : SWEEP_DAYS);
}

/**
 * Fetch targets for a sweep. Only leads that already have a URL compete here: while URL-less leads
 * shared these slots, an 18-slot sweep was filled by leads that had been fetched five times and
 * BRIDGE Guitar Festival was never looked at once.
 */
export function selectDueLeads(leads: Lead[], now: Date, bootstrap: boolean) {
  // Cold-starting a city is a one-time cost, and the trial showed that leaving 30 leads unchecked
  // for two months is a worse failure than the extra spend.
  const scale = bootstrap ? 2 : 1;
  const due = leads.filter((lead) => lead.url && Date.parse(lead.nextCheck) <= now.getTime());
  const calendars = due.filter((lead) => lead.kind === "calendar")
    .sort(queueOrder).slice(0, CALENDAR_SLOTS * scale);
  const events = due.filter((lead) => lead.kind !== "calendar")
    .sort(queueOrder)
    .slice(0, FETCH_SLOTS * scale - calendars.length);
  return [...calendars, ...events];
}

/** Leads that cannot be fetched until a search finds their owner. Reserved slots of their own. */
export function selectResolveLeads(leads: Lead[], now: Date, bootstrap: boolean) {
  return leads.filter((lead) => !lead.url && Date.parse(lead.nextCheck) <= now.getTime())
    .sort(queueOrder)
    .slice(0, RESOLVE_SLOTS * (bootstrap ? 2 : 1));
}

// This account's own editions first, then whatever has consumed the least budget so far.
function queueOrder(left: Lead, right: Lead) {
  return Number(right.origin === "portfolio") - Number(left.origin === "portfolio")
    || (left.attempts ?? 0) - (right.attempts ?? 0)
    || left.nextCheck.localeCompare(right.nextCheck);
}

/** Static half of the fetch prompt. Byte-identical across a pass so the prefix can be cached. */
export function longRangeVerificationInstructions(input: CollectionWindow & { location: string; radiusKm: number }) {
  return `Find announced editions between ${input.start} and ${input.end} within ${input.radiusKm} km of ${input.location}. The lead is named at the end of this message. Its page may describe an older edition: follow an observed official link to future dates, about/info, news or a calendar if necessary, with at most TWO fetched pages total. A future-dates section on an official organiser or federation page IS valid date evidence even if its header still promotes this year's edition. Return up to eight major demand-driving editions, including other event series if the fetched page contains a programme. Prioritise significance and spread across the full requested period, NOT the earliest eight dates. Skip routine single-artist shows, club nights, theatre runs and local activities; retain multi-day festivals, conferences and championships. Keep dates even if demand is unknown: use impactPoints null and overnightAudience null rather than dropping the event. Never move an old date forward a year or use recurrence as confirmation. A historical attendance total is NOT this edition's attendance. Include a short reason if no edition is confirmed. Use only facts on pages actually fetched. sourceUrl must be that fetched owner page, never a search snippet or aggregator. Use ownerType other for tourist listings, blogs, Wikipedia and directories. Confirm title, date and location separately. On a series' own official site, locationConfirmed=true when the page, the site or the series identifies its host city or venue anywhere — a future-dates list does not have to repeat the city next to each date. On a multi-venue calendar the entry itself must name the place. Record exact first/last date of each edition. Date sections on organiser about/info pages and federation calendar entries count. Do not reject confirmed dates for missing audience information: impactPoints=null. Assess demand separately: 35 Medium without a strong current-edition demand signal, 45 High with evidence of national/international visitors, hotel information or significant attendance for this edition; 60 Peak only with exceptional citywide demand. Duration, international performers and historical attendance alone do not establish travelling audiences. Put the supporting current-edition statement in evidenceText; do not fabricate attendance, capacity or audience origin. Do not guess coordinates. Return JSON only.`;
}

/**
 * Second-page instruction. A hub that already produced editions still hides the ones it listed
 * without a full date or host city — the ONMK masters sit on knzb.nl's calendar as "6-9 mei" with
 * the city on a separate news page — so hubs are sent one level deeper regardless of yield.
 */
function deepInstruction(lead: Lead, year: string) {
  let host = "";
  try { host = new URL(lead.url!).hostname; } catch { host = ""; }
  const target = lead.kind === "calendar"
    ? "an entry on this calendar whose date, year or host city was incomplete on the overview"
    : `a later edition of ${lead.title}`;
  return `Then read a SECOND page on ${host}. Use one web_search to surface it — query "${host} ${lead.title} ${year}" or "site:${host} agenda editie programma" — because web_fetch can only open a URL that a tool has already returned. Then fetch the ${host} page that announces ${target}: an about, editie/edition, agenda, programma, kalender, nieuws or detail page. Do not report the page you already read, and never take dates from a search snippet or another site.`;
}

function parseMessage<T>(message: Anthropic.Message, schema: z.ZodType<T>): T {
  if (message.stop_reason === "max_tokens" || message.stop_reason === "pause_turn") throw new Error(`Incomplete response: ${message.stop_reason}`);
  const text = message.content.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("No structured result");
  return schema.parse(JSON.parse(text));
}

type Job = { lead: Lead; kind: "fetch" | "deep" | "resolve" };

export async function collectLongRange(input: LongRangeInput): Promise<SourceResult> {
  const store = input.store ?? createLongRangeStore();
  const key = longRangeMarketKey(input.location, input.radiusKm);
  if (!await store.acquire(key)) throw new LongRangeLeaseError();
  try {
    return await collectLockedLongRange({ ...input, store }, key);
  } finally {
    await store.release(key);
  }
}

async function collectLockedLongRange(input: LongRangeInput & { store: LongRangeStore }, key: string): Promise<SourceResult> {
  const now = input.now ?? new Date();
  const store = input.store;
  const version = LONG_RANGE_VERSION * 1000 + CLAUDE_ASSESSMENT_VERSION;
  const state = await store.load(key) ?? { version, discoveredAt: null, leads: [] };
  if (state.version !== version) {
    state.version = version;
    state.discoveredAt = null;
    delete state.discoveryAttemptAt;
    delete state.lastPassAt;
    delete state.lastSweepAt;
    state.leads.forEach((lead) => { lead.nextCheck = now.toISOString(); });
  }
  const model = input.model ?? process.env.ANTHROPIC_MODEL;
  if (!model) throw new Error("ANTHROPIC_MODEL is required");
  const discoveryModel = input.discoveryModel ?? process.env.ANTHROPIC_DISCOVERY_MODEL ?? model;
  // Picking the official domain out of search results is the same job the near-term collector
  // already gives Haiku; date extraction stays on the main model.
  const resolutionModel = input.resolutionModel ?? process.env.ANTHROPIC_TRIAGE_MODEL ?? DEFAULT_TRIAGE_MODEL;
  const client = input.client ?? new Anthropic();
  const batching = input.batching ?? { enabled: !input.client && process.env.ANTHROPIC_BATCHES !== "disabled" };
  const usage: Record<string, number> = { inputTokens: 0, outputTokens: 0, webSearchRequests: 0, webFetchRequests: 0, estimatedCostUsd: 0 };
  const drops: NonNullable<SourceResult["funnel"]>["drops"] = [];
  const failures: string[] = [];
  let requests = 0;
  let discovered = 0;
  let verifiedPages = 0;
  const searchTool = { type: "web_search_20260318" as const, name: "web_search" as const, allowed_callers: ["direct" as const], max_uses: 1, user_location: { type: "approximate" as const, country: "NL", city: input.location, timezone: "Europe/Amsterdam" } };
  // Owner domains rank below aggregators for some series (revolutionrisingfest.com sat at rank 7),
  // so the resolver gets one rephrase rather than returning null on a single bad result page.
  const resolveTool = { ...searchTool, max_uses: 2 };
  const fetchTool = { type: "web_fetch_20260318" as const, name: "web_fetch" as const, allowed_callers: ["direct" as const], max_uses: 2, max_content_tokens: 6_000, citations: { enabled: false } };
  async function observe(message: Anthropic.Message, stage: "discovery" | "verification", usedModel: string) {
    const event = usageEvent(message, stage === "discovery" ? "discovery" : "discovery_fetch", usedModel);
    await input.onUsage?.(event);
    for (const field of ["inputTokens", "outputTokens", "webSearchRequests", "webFetchRequests"] as const) {
      usage[field] += event[field];
      usage[`${stage}_${field}`] = (usage[`${stage}_${field}`] ?? 0) + event[field];
    }
    const billed = event.inputTokens + event.outputTokens > 0;
    const cacheWrite = billed ? message.usage.cache_creation_input_tokens ?? 0 : 0;
    const cacheRead = billed ? message.usage.cache_read_input_tokens ?? 0 : 0;
    usage.cacheWriteTokens = (usage.cacheWriteTokens ?? 0) + cacheWrite;
    usage.cacheReadTokens = (usage.cacheReadTokens ?? 0) + cacheRead;
    // Official list prices checked 2026-09-05. Unknown models are explicitly unpriced.
    const rates = usedModel.startsWith("claude-sonnet-5") ? [2, 10] : usedModel.startsWith("claude-haiku-4-5") ? [1, 5] : usedModel.startsWith("claude-sonnet-4") ? [3, 15] : null;
    if (!rates) usage.unpricedRequests = (usage.unpricedRequests ?? 0) + 1;
    else {
      const cost = ((event.inputTokens + cacheWrite * 1.25 + cacheRead * 0.1) * rates[0] + event.outputTokens * rates[1]) / 1_000_000 * (batching.enabled ? 0.5 : 1) + event.webSearchRequests * 0.01;
      usage.estimatedCostUsd += cost;
      usage[`${stage}_estimatedCostUsd`] = (usage[`${stage}_estimatedCostUsd`] ?? 0) + cost;
    }
  }

  // Editions this account already confirmed carry an official URL that cost nothing to obtain, and
  // their end date is the anchor the announcement window is measured from.
  for (const seed of input.seeds ?? []) {
    // Start after the full last day, not at midnight on an edition that is still running.
    const endedAt = new Date(Date.parse(`${seed.lastEditionEnd}T00:00:00Z`) + day).toISOString();
    const seedKey = createHash("sha256").update(labelKey(seed.title)).digest("hex");
    const existing = state.leads.find((lead) => lead.key === seedKey || lead.url === seed.url);
    if (!existing) {
      state.leads.push({ key: seedKey, title: seed.title, url: seed.url, kind: "event", group: 0,
        origin: "portfolio", anchor: seed.lastEditionEnd, attempts: 0, checkedAt: null,
        nextCheck: endedAt > now.toISOString() ? endedAt : now.toISOString(), outcome: "pending", editions: [], notes: [] });
      continue;
    }
    existing.origin = "portfolio";
    existing.url ??= seed.url;
    if (!existing.anchor || existing.anchor < seed.lastEditionEnd) existing.anchor = seed.lastEditionEnd;
    // Only re-open a lead we have not looked at since this edition ended. Without this guard every
    // cron run in the weeks after an edition would re-fetch the same page.
    if (existing.outcome !== "confirmed" && (!existing.checkedAt || existing.checkedAt < endedAt)) {
      existing.nextCheck = endedAt > now.toISOString() ? endedAt : now.toISOString();
    }
  }

  const discoveryDue = (!state.discoveredAt || now.getTime() - Date.parse(state.discoveredAt) >= 30 * day)
    && (!state.discoveryAttemptAt || now.getTime() - Date.parse(state.discoveryAttemptAt) >= 7 * day);
  if (discoveryDue) {
    state.discoveryAttemptAt = now.toISOString();
    const tasks = groups.flatMap((group, index) => ["event", "calendar"].map((kind) => ({
      group: index,
      query: kind === "event" ? `${input.location} ${group.topic}` : `${input.location} ${group.futureTopic} ${input.end.slice(0, 4)}`,
      focus: group.focus,
    })));
    const results = await requestMessages(client, "search", tasks.map((task) => ({
      options: { timeout: 180_000, maxRetries: 0 },
      params: {
        model: discoveryModel, max_tokens: 3000,
        ...(discoveryModel.startsWith("claude-sonnet-5") ? { thinking: { type: "disabled" as const } } : {}),
        tools: [searchTool], output_config: { format: zodOutputFormat(discoverySchema) },
        messages: [{ role: "user", content: `Use exactly one web_search with query "${task.query}". Discover major hotel-demand event SERIES and official organiser/venue/federation calendars within ${input.radiusKm} km of ${input.location}: ${task.focus}. Return up to six concrete names, including useful official calendar sources. Older/current editions are valid LEADS: do not require future dates. Prioritise active recurring series or announced future editions with travelling audiences. Exclude defunct series and historical one-off championships; do not treat a decades-old hosting as a recurring city event. Skip small local activities. Copy URLs literally from search results, otherwise null. Return the URL of the organiser, venue, club, federation or university that OWNS the event/programme; Wikipedia, tourist listings, ticket aggregators and event directories are NOT event owners, so retain their event names but return url=null for them. Use the actual event/series name, not generic labels such as Expo & Congress. Do not invent names or URLs. Return JSON only.` }],
      },
    })), batching);
    requests += tasks.length;
    usage.plannedSearches = tasks.length;
    usage.completedSearches = 0;
    for (let index = 0; index < results.length; index++) {
      try {
        const result = results[index];
        if (result.status === "rejected") throw result.reason;
        await observe(result.value, "discovery", discoveryModel);
        if (!(result.value.usage.server_tool_use?.web_search_requests)) throw new Error("Search tool not executed");
        const parsed = parseMessage(result.value, z.object({ leads: z.array(z.unknown()) }));
        usage.completedSearches++;
        const observed = sourceUrls(result.value);
        for (const raw of parsed.leads.slice(0, 6)) {
          const checked = leadSchema.safeParse(raw);
          if (!checked.success) {
            drops.push({ title: tasks[index].query, stage: "discovery", reason: "Invalid individual lead omitted; other leads retained." });
            continue;
          }
          const item = checked.data;
          // The model was measurably bad at judging officiality, so the URL is taken from the
          // results we already paid for and screened against a host list instead.
          const repaired = repairObservedUrl(item.url, observed);
          const url = repaired && !isAggregatorUrl(repaired) ? repaired : null;
          if (item.kind === "calendar" && !url) continue;
          const existing = state.leads.find((lead) => labelKey(lead.title) === labelKey(item.title) || (url && lead.url === url));
          if (existing) { existing.url ??= url; continue; }
          // A hub is a page, so without a URL the lead is scheduled and resolved as a series:
          // BRIDGE Guitar Festival arrived as kind "venue" and inherited a hub's flat schedule.
          const kind = url && (item.kind !== "event" || /agenda|calendar|kalender/i.test(new URL(url).pathname)) ? "calendar" : "event";
          state.leads.push({ title: item.title, kind, url, key: createHash("sha256").update(labelKey(item.title)).digest("hex"), group: tasks[index].group, attempts: 0, checkedAt: null, nextCheck: now.toISOString(), outcome: "pending", editions: [], notes: [] });
          discovered++;
        }
      } catch (error) {
        const reason = errorText(error);
        failures.push(reason);
        drops.push({ title: tasks[index].query, stage: "discovery", reason });
      }
    }
    if (usage.completedSearches === tasks.length) state.discoveredAt = now.toISOString();
    await store.save(key, state);
  }
  // Seeds and discovery are the only things that add leads, so one prune covers both.
  for (const dropped of pruneLeads(state.leads)) {
    drops.push({ title: dropped.title, stage: "discovery", reason: "Lead cap reached; unannounced lead with the most attempts dropped." });
  }

  // One full sweep per 28 days. Between sweeps the pass only chases editions that just ended,
  // which is what keeps the monthly bill under a dollar per market.
  const bootstrap = !state.lastSweepAt;
  const sweepDue = discoveryDue || bootstrap
    || now.getTime() - Date.parse(state.lastSweepAt!) >= SWEEP_DAYS * day;
  const due = sweepDue
    ? selectDueLeads(state.leads, now, bootstrap)
    : state.leads
        .filter((lead) => lead.origin === "portfolio" && lead.url
          && Date.parse(lead.nextCheck) <= now.getTime())
        .sort((a, b) => a.nextCheck.localeCompare(b.nextCheck))
        .slice(0, SEED_SLOTS);
  const toResolve = sweepDue ? selectResolveLeads(state.leads, now, bootstrap) : [];
  const scale = sweepDue && bootstrap ? 2 : 1;
  const makeRequest = ({ lead, kind }: Job) => ({
    options: { timeout: 180_000, maxRetries: 0 },
    params: kind === "resolve" ? {
      model: resolutionModel, max_tokens: 4000,
      tools: [resolveTool], output_config: { format: zodOutputFormat(resolutionSchema) },
      messages: [{ role: "user" as const, content: `Use web_search, at most TWICE, to find the official page of this event series. Start with the query "${lead.title} ${input.location} ${input.end.slice(0, 4)} officiële website". If no organiser, venue, club or federation page for this series appears in those results, search once more with a different phrasing before giving up. Copy the URL literally from a search result; a path you assemble yourself is rejected, so return the exact result URL even when a deeper page probably exists. The HOST VENUE counts as official: when the series has no site of its own, return the venue's page for this series, or the venue's own domain. Prefer a future-dates/about or announcement page, but ACCEPT the official homepage even when its search snippet only mentions an older/current edition. Future dates are NOT required in search snippets; they will be checked by fetching the page next. Never return a tourist listing, aggregator, ticket shop, festival directory, news site or wiki, even when it ranks above the owner. Return url=null only if no official event-owner or host-venue URL was observed, and a short reason. Do not fetch or verify dates in this step.` }],
    } : {
      model, max_tokens: 4000,
      ...(model.startsWith("claude-sonnet-5") ? { thinking: { type: "disabled" as const } } : {}),
      // web_fetch only accepts URLs a tool already returned, so the second page needs one search on
      // the lead's own host to become reachable at all: ddw.nl's 2027 dates live on site.ddw.nl.
      tools: kind === "deep" ? [fetchTool, searchTool] : [fetchTool],
      output_config: { format: zodOutputFormat(editionSchema) },
      // Lead-specific text goes last so every fetch in a pass shares a byte-identical cacheable prefix.
      messages: [{ role: "user" as const, content: [
        { type: "text" as const, text: longRangeVerificationInstructions(input), cache_control: { type: "ephemeral" as const } },
        { type: "text" as const, text: `Lead: ${lead.title}\nFirst fetch this observed official source: ${lead.url}${kind === "deep" ? `\n${deepInstruction(lead, input.end.slice(0, 4))}` : ""}` },
      ] }],
    },
  });
  const applyResult = (lead: Lead, message: Anthropic.Message) => {
    const parsed = parseMessage(message, editionSchema);
    const observed = fetchedUrls(message);
    if (!observed.length) throw new Error(NO_PAGE);
    verifiedPages += observed.length;
    lead.notes = [parsed.reason];
    const editions = parsed.events.flatMap((event): EventCandidate[] => {
      if (!observedUrl(event.sourceUrl, observed) || event.ownerType === "other" || !event.titleConfirmed || !event.dateConfirmed || !event.locationConfirmed) return [];
      const start = event.startAt.slice(0, 10);
      const end = event.endAt.slice(0, 10);
      const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
      if (!validDate(start) || !validDate(end) || end < start || start > input.end || end < input.start) return [];
      const candidate: EventCandidate = {
        provider: "claude", providerEventId: "", sourceUrl: event.sourceUrl,
        title: event.title, category: event.category, venue: event.venue,
        latitude: event.latitude, longitude: event.longitude, regionScope: event.regionScope,
        startAt: `${start}T00:00:00Z`, endAt: `${end}T23:59:59Z`, sourceState: event.status,
        certainty: "confirmed", localRank: null, attendance: event.attendance, venueCapacity: event.venueCapacity,
        aiImpactPoints: [35, 45, 60].includes(event.impactPoints ?? 0) ? event.impactPoints : null,
        assessmentVersion: CLAUDE_ASSESSMENT_VERSION, overnightAudience: event.overnightAudience,
        evidenceText: event.evidenceText, primarySourceConfirmed: true,
      };
      candidate.providerEventId = claudeProviderEventId(candidate);
      return [candidate];
    });
    if (editions.length) {
      if (lead.kind === "event") lead.url = editions[0].sourceUrl;
      const sameEditionDates = (a: EventCandidate, b: EventCandidate) => labelKey(a.title) === labelKey(b.title) && a.startAt === b.startAt && a.endAt === b.endAt;
      // Several editions can legitimately share a series and year. A date is ambiguous only when
      // it is new AND replaces a stored edition absent from this response. Exact repeats and an
      // additional edition alongside the existing one are not changes to the existing dates.
      const conflicts = editions.filter((event) => !lead.editions.some((old) => sameEditionDates(old, event))
        && lead.editions.some((old) => labelKey(old.title) === labelKey(event.title)
          && old.startAt.slice(0, 4) === event.startAt.slice(0, 4)
          && !editions.some((current) => sameEditionDates(old, current))));
      lead.outcome = conflicts.length || lead.outcome === "conflict" ? "conflict" : "confirmed";
      // Provider IDs omit end dates; preserve both pieces of evidence for an end-only conflict.
      lead.editions = [...new Map([...lead.editions, ...editions].map((event) => [`${event.providerEventId}|${event.endAt}`, event])).values()];
      if (conflicts.length) lead.notes.push("Conflicting dates retained for review; editions withheld.");
      // The next announcement window is measured from the latest edition we now know about.
      const latest = lead.editions.map((event) => event.endAt.slice(0, 10)).sort().at(-1);
      if (latest && (!lead.anchor || lead.anchor < latest)) lead.anchor = latest;
    } else if (!lead.editions.length) lead.outcome = "unannounced";
    return editions.length > 0;
  };
  const finalize = (lead: Lead) => {
    lead.checkedAt = now.toISOString();
    lead.nextCheck = nextCheckAt(lead, now);
    if (lead.outcome === "failed" || lead.outcome === "conflict") failures.push(`${lead.title}: ${lead.notes.join(" ")}`);
    if (!lead.editions.length) drops.push({ title: lead.title, stage: "verification", reason: lead.notes.join(" ") });
  };

  // Round A fetches every lead that already has a URL and resolves a capped number that do not.
  // Round B reads a second page: for an event lead only when the first page was empty, for a
  // calendar hub always, since a hub's overview entries point at the detail page that has the year.
  let pending: Job[] = [
    ...due.map((lead): Job => ({ lead, kind: "fetch" })),
    ...toResolve.map((lead): Job => ({ lead, kind: "resolve" })),
  ];
  let deepBudget = DEEP_SLOTS * scale;
  for (let round = 0; round < 2 && pending.length; round++) {
    const results = await requestMessages(client, "verification", pending.map(makeRequest), batching);
    requests += pending.length;
    for (const job of pending) usage[`${job.kind}Requests`] = (usage[`${job.kind}Requests`] ?? 0) + 1;
    const next: Job[] = [];
    for (let index = 0; index < results.length; index++) {
      const job = pending[index];
      const lead = job.lead;
      lead.attempts = (lead.attempts ?? 0) + 1;
      let found = false;
      try {
        const result = results[index];
        if (result.status === "rejected") throw result.reason;
        await observe(result.value, "verification", job.kind === "resolve" ? resolutionModel : model);
        if (job.kind === "resolve") {
          if (!result.value.usage.server_tool_use?.web_search_requests) throw new Error("URL search not executed");
          const resolved = parseMessage(result.value, resolutionSchema);
          lead.notes = [resolved.reason];
          const resolvedUrl = repairObservedUrl(resolved.url, sourceUrls(result.value));
          if (resolvedUrl && !isAggregatorUrl(resolvedUrl)) {
            lead.url = resolvedUrl;
            lead.outcome = "pending";
            if (round === 0) { next.push({ lead, kind: "fetch" }); continue; }
          } else {
            lead.outcome = "unannounced";
            // Without this the drop reads as "no official page exists" when the model in fact named
            // one and had its URL refused as unobserved or as an aggregator.
            if (resolved.url) lead.notes.push(`Refused URL ${resolved.url}: not observed in the search results, or a known aggregator.`);
          }
        } else {
          found = applyResult(lead, result.value);
          // A lead whose fetch threw never reached a page, so a second page is not the missing
          // piece; it waits for the resolver on a later pass instead.
          const deepen = job.kind === "fetch" && (lead.kind === "calendar" || !found);
          if (deepen && round === 0 && deepBudget > 0) {
            deepBudget--;
            next.push({ lead, kind: "deep" });
            continue;
          }
        }
      } catch (error) {
        lead.outcome = "failed";
        lead.notes = [errorText(error)];
        // `url_not_allowed` (robots.txt) makes a URL permanently unfetchable, and keeping it would
        // burn a fetch slot every sweep while hiding the lead from the resolver.
        if (job.kind !== "resolve" && lead.notes[0] === NO_PAGE) lead.url = null;
      }
      finalize(lead);
    }
    await store.save(key, state);
    pending = next;
  }
  const candidates = [...new Map(state.leads.filter((lead) => lead.outcome !== "conflict").flatMap((lead) => lead.editions)
    .filter((event) => event.startAt.slice(0, 10) <= input.end && event.endAt.slice(0, 10) >= input.start)
    .map((event) => [event.providerEventId, event])).values()];
  const unresolved = state.leads.filter((lead) => lead.outcome !== "confirmed").length;
  for (const event of candidates) {
    if ((event.latitude === null || event.longitude === null) && event.venue) {
      const location = await (input.geocode ?? geocodeVenue)(`${event.venue}, ${input.location}`);
      event.latitude = location?.latitude ?? null;
      event.longitude = location?.longitude ?? null;
    }
  }
  if (due.length || toResolve.length) {
    state.lastPassAt = now.toISOString();
    if (sweepDue) state.lastSweepAt = now.toISOString();
  }
  await store.save(key, state);
  const deferred = state.leads.filter((lead) => Date.parse(lead.nextCheck) <= now.getTime()).length;
  usage.discovered = discovered;
  usage.datesConfirmed = candidates.length;
  usage.demandAccepted = candidates.filter((event) => (event.aiImpactPoints ?? 0) >= 45).length;
  usage.unresolved = unresolved;
  usage.budgetDeferred = deferred;
  usage.cachedLeads = state.leads.length - due.length - toResolve.length;
  usage.sweep = sweepDue ? 1 : 0;
  return { source: "claude", candidates, requests, usage,
    quarantinedProviderEventIds: state.leads.filter((lead) => lead.outcome === "conflict").flatMap((lead) => lead.editions.map((event) => event.providerEventId)),
    ...(failures.length ? { error: failures.join("; ") } : {}),
    funnel: { namesDiscovered: discovered, urlsResolved: [...due, ...toResolve].filter((lead) => lead.url).length, pagesVerified: verifiedPages, demandAccepted: usage.demandAccepted, drops },
  };
}

/**
 * Keeps stored state bounded. Leads that hold an edition or came from this account's own calendar
 * are never dropped; the rest go worst-first, which is a lead that has been looked at repeatedly
 * and never announced anything.
 */
export function pruneLeads(leads: Lead[]): Lead[] {
  const excess = leads.length - LEAD_CAP;
  if (excess <= 0) return [];
  const dropped = leads
    .filter((lead) => !lead.editions.length && lead.origin !== "portfolio")
    .sort((a, b) =>
      Number(b.outcome === "unannounced") - Number(a.outcome === "unannounced")
      || (b.attempts ?? 0) - (a.attempts ?? 0)
      || (a.checkedAt ?? "9999").localeCompare(b.checkedAt ?? "9999"))
    .slice(0, excess);
  for (const lead of dropped) leads.splice(leads.indexOf(lead), 1);
  return dropped;
}

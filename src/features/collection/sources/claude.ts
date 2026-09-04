import Anthropic, { APIConnectionTimeoutError } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";
import { createHash } from "node:crypto";
import { z } from "zod";

import type { DemandTriage, EvidenceReview } from "@/features/events/hotel-demand";
import { normalizeText } from "@/features/events/normalize";
import { overnightAudiences, type EventCandidate } from "@/features/events/types";
import { getAddressById, searchAddresses } from "@/features/portfolio/geocode";

import type { CollectionWindow, DiscoveryDrop, SourceResult } from "../types";
import {
  loadClaudeMarketResult,
  runAnthropicBatch,
  saveClaudeMarketResult,
  type BatchStore,
  type ClaudeMarketInput,
} from "../anthropic-batches";

const ownerTypes = ["organizer", "venue", "club", "federation", "ticket_provider", "university", "municipality", "event_owner"] as const;
const searchRequestOptions = { timeout: 180_000, maxRetries: 1 } as const;
const verificationRequestOptions = { timeout: 180_000, maxRetries: 0 } as const;
const triageRequestOptions = { timeout: 90_000, maxRetries: 0 } as const;
const DEFAULT_TRIAGE_MODEL = "claude-haiku-4-5-20251001";

export type ClaudeUsageEvent = {
  phase: "discovery" | "discovery_fetch" | "demand_triage" | "demand_verification";
  model: string;
  inputTokens: number;
  outputTokens: number;
  webSearchRequests: number;
  webFetchRequests: number;
};

type UsageObserver = (usage: ClaudeUsageEvent) => void | Promise<void>;
const unbilledMessages = new WeakSet<Anthropic.Message>();
const outputSchema = z.object({
  events: z.array(
    z.object({
      sourceUrl: z.url(),
      title: z.string(),
      category: z.string(),
      venue: z.string().nullable(),
      latitude: z.number().nullable(),
      longitude: z.number().nullable(),
      regionScope: z.string().nullable(),
      startAt: z.string(),
      endAt: z.string(),
      status: z.enum(["active", "cancelled", "postponed"]),
      ownerType: z.enum([...ownerTypes, "other"]),
      evidenceText: z.string().nullable(),
      impactPoints: z.number().int().nullable(),
      overnightAudience: z.enum(overnightAudiences).nullable(),
      titleConfirmed: z.boolean(),
      dateConfirmed: z.boolean(),
      locationConfirmed: z.boolean(),
    }),
  ).max(1),
});

const discoverySchema = z.object({
  candidates: z.array(z.object({
    title: z.string(),
    startDate: z.string(),
    endDate: z.string().nullable(),
    city: z.string(),
    venue: z.string().nullable(),
    category: z.string(),
    officialUrl: z.url().nullable(),
  })).max(10),
  agendaUrls: z.array(z.url()).max(2),
});

type DiscoveredCandidate = {
  title: string;
  startDate: string;
  endDate: string | null;
  city: string;
  venue: string | null;
  category: string;
  officialUrl: string | null;
};

// `weekly` is deliberately absent. Recurrence is unobservable in a single dated candidate, so
// the category could only ever be a guess — and "Feyenoord - Inter (Champions League)" reads as
// a weekly fixture to any model asked the question. What it legitimately caught (recurring
// markets and classes) is already covered by `market` and `course`.
const excludableCategories = ["artist_show", "theatre_run", "market", "course"] as const;

const discoveryTriageSchema = z.object({
  reviews: z.array(z.object({
    index: z.number().int(),
    decision: z.enum(["verify", "exclude"]),
    excludeAs: z.enum(excludableCategories).nullable(),
    act: z.string().nullable(),
    reason: z.string(),
  })),
});

// A metadata-only exclusion has to quote the words in the title that carry the category, and
// those words have to actually be there. Any free text in `act` would let "act: concert" reject
// anything, and "probably a club night" would remove a festival nobody recognised. A multi-day
// programme is additionally never a one-off show.
export function triageExclusionAllowed(
  review: { decision: string; excludeAs: string | null; act: string | null },
  candidate: { title: string; startDate: string; endDate: string | null },
) {
  if (review.decision !== "exclude") return false;
  if (!excludableCategories.includes(review.excludeAs as (typeof excludableCategories)[number])) {
    return false;
  }
  const quoted = normalizeText(review.act ?? "");
  if (!quoted || !normalizeText(candidate.title).includes(quoted)) return false;
  const multiDay = (candidate.endDate ?? candidate.startDate) !== candidate.startDate;
  return review.excludeAs !== "artist_show" || !multiDay;
}

type VerificationEntry = {
  title: string | null;
  startDate: string | null;
  venue: string | null;
  city: string | null;
  officialUrl: string | null;
  search: boolean;
};

const demandTriageSchema = z.object({
  reviews: z.array(z.object({
    providerEventId: z.string(),
    decision: z.enum(["exclude", "verify", "provisional"]),
    confidence: z.enum(["high", "medium", "low"]),
    demandLevel: z.enum(["low", "medium", "high", "peak"]),
    evidenceText: z.string(),
  })),
});

const evidenceReviewSchema = z.object({
  providerEventId: z.string(),
  decision: z.enum(["verified", "unverifiable"]),
  confidence: z.enum(["high", "medium", "low"]),
  sourceUrl: z.url().nullable(),
  ownerType: z.string(),
  evidenceText: z.string(),
  titleConfirmed: z.boolean(),
  dateConfirmed: z.boolean(),
  locationConfirmed: z.boolean(),
});

function sourceUrls(message: Anthropic.Message) {
  const urls = new Set<string>();
  message.content.forEach((block) => {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      block.content.forEach((result) => urls.add(result.url));
    }
    if (block.type === "web_fetch_tool_result" && block.content.type === "web_fetch_result") {
      urls.add(block.content.url);
    }
    if (block.type === "text") {
      block.citations?.forEach((citation) => {
        if (citation.type === "web_search_result_location") urls.add(citation.url);
      });
    }
  });
  return [...urls];
}

function fetchedUrls(message: Anthropic.Message) {
  return message.content.flatMap((block) =>
    block.type === "web_fetch_tool_result" && block.content.type === "web_fetch_result"
      ? [block.content.url]
      : [],
  );
}

const dutchMonthFormat = new Intl.DateTimeFormat("nl-NL", { month: "long", year: "numeric", timeZone: "UTC" });
const englishMonthFormat = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

type MonthLabel = { nl: string; en: string };

function monthLabels(day: string): MonthLabel {
  const date = new Date(`${day}T00:00:00Z`);
  return { nl: dutchMonthFormat.format(date), en: englishMonthFormat.format(date) };
}

function dropReason(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function comparableUrl(value: string) {
  const url = new URL(value);
  return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`.toLowerCase();
}

function observedUrl(value: string | null, observed: string[]) {
  if (!value) return false;
  try {
    const target = comparableUrl(value);
    return observed.some((url) => {
      try { return comparableUrl(url) === target; } catch { return false; }
    });
  } catch {
    return false;
  }
}

function isPublicEvidenceUrl(value: string) {
  if (/[\s'"{}\[\],]/.test(value)) return false;
  if ((value.match(/https?:\/\//gi) ?? []).length > 1) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.hostname !== "api.predicthq.com";
  } catch {
    return false;
  }
}

function stripFragment(value: string | null) {
  if (!value) return value;
  const hash = value.indexOf("#");
  return hash === -1 ? value : value.slice(0, hash);
}

function parentPath(value: string) {
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2) return null;
    return `${url.origin}/${segments.slice(0, -1).join("/")}`;
  } catch {
    return null;
  }
}

function supportedObservedUrl(value: string | null, evidenceText: string, observed: string[]) {
  const publicObserved = observed.filter(isPublicEvidenceUrl);
  if (value && isPublicEvidenceUrl(value) && observedUrl(value, publicObserved)) {
    const target = comparableUrl(value);
    return publicObserved.find((url) => {
      try { return comparableUrl(url) === target; } catch { return false; }
    }) ?? value;
  }
  const mentioned = evidenceText.match(/https?:\/\/[^\s)\]}>,]+/g) ?? [];
  for (const url of mentioned) {
    if (isPublicEvidenceUrl(url) && observedUrl(url, publicObserved)) return url;
  }
  return publicObserved.length === 1 ? publicObserved[0] : null;
}

export function claudeProviderEventId(event: Pick<EventCandidate, "sourceUrl" | "title" | "startAt" | "venue">) {
  const identity = [event.sourceUrl, normalizeText(event.title), event.startAt.slice(0, 10), normalizeText(event.venue ?? "")].join("|");
  return `claude:${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

async function geocodeVenue(query: string) {
  try {
    const [suggestion] = await searchAddresses(query);
    if (!suggestion) return null;
    const address = await getAddressById(suggestion.id);
    return { latitude: address.latitude, longitude: address.longitude };
  } catch {
    return null;
  }
}

async function requestPhase<T>(phase: "search" | "agenda" | "triage" | "verification", request: () => Promise<T>) {
  try {
    return await request();
  } catch (error) {
    if (error instanceof APIConnectionTimeoutError) throw new Error(`Claude ${phase} timed out.`);
    throw error;
  }
}

function usageEvent(message: Anthropic.Message, phase: ClaudeUsageEvent["phase"], model: string): ClaudeUsageEvent {
  const billed = !unbilledMessages.has(message);
  return {
    phase,
    model,
    inputTokens: billed ? message.usage.input_tokens : 0,
    outputTokens: billed ? message.usage.output_tokens : 0,
    webSearchRequests: billed ? message.usage.server_tool_use?.web_search_requests ?? 0 : 0,
    webFetchRequests: billed ? message.usage.server_tool_use?.web_fetch_requests ?? 0 : 0,
  };
}

async function observeUsage(observer: UsageObserver | undefined, event: ClaudeUsageEvent) {
  if (observer) await observer(event);
}

type MessageRequest = {
  params: MessageCreateParamsNonStreaming;
  options: { timeout: number; maxRetries: number };
};

type Batching = {
  enabled: boolean;
  store?: BatchStore;
  wait?: (milliseconds: number) => Promise<void>;
};

async function requestMessages(
  client: Anthropic,
  phase: "search" | "agenda" | "triage" | "verification",
  requests: MessageRequest[],
  batching: Batching,
) {
  if (!batching.enabled) {
    // Eight at a time, as before batching existed. Firing a 40-entry verification queue at once
    // draws 429s, and a rate-limited run looks exactly like a run that found less.
    const settled: PromiseSettledResult<Anthropic.Message>[] = [];
    for (let index = 0; index < requests.length; index += 8) {
      settled.push(...await Promise.allSettled(
        requests.slice(index, index + 8).map((request) =>
          requestPhase(phase, () => client.messages.create(request.params, request.options)),
        ),
      ));
    }
    return settled;
  }
  const results = await runAnthropicBatch(client, requests.map((request) => request.params), {
    store: batching.store,
    wait: batching.wait,
  });
  return results.map((result): PromiseSettledResult<Anthropic.Message> => {
    if (result.status === "rejected") return result;
    if (!result.value.billable) unbilledMessages.add(result.value.message);
    return { status: "fulfilled", value: result.value.message };
  });
}

// Each group carries its own query. A shared example query collapses all four into the same
// generic consumer-agenda search, which never reaches business demand: international trade
// fairs and congresses are indexed in English, so that group searches in English.
const searchGroups = [
  { focus: "stadsbrede festivals, design weeks en marathons", query: (city: string, month: MonthLabel) => `festivals en stadsevenementen ${city} ${month.nl}` },
  { focus: "congressen, tentoonstellingen, vakbeurzen en conferenties", query: (city: string, month: MonthLabel) => `trade fairs conferences exhibitions ${city} ${month.en}` },
  { focus: "grote concerten en meerdaagse entertainment-evenementen", query: (city: string, month: MonthLabel) => `concerten en shows ${city} ${month.nl}` },
  { focus: "bevestigde professionele sportwedstrijden en sporttoernooien", query: (city: string, month: MonthLabel) => `sportevenementen en wedstrijden ${city} ${month.nl}` },
] as const;

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function searchWindows(start: string, end: string) {
  const boundedEnd = [addDays(start, 90), end].sort()[0];
  return [0, 30, 60].flatMap((offset, index) => {
    const sliceStart = addDays(start, offset);
    if (sliceStart > boundedEnd) return [];
    return [{
      start: sliceStart,
      end: index === 2
        ? boundedEnd
        : [addDays(start, offset + 29), boundedEnd].sort()[0],
    }];
  });
}

async function triageDiscoveries(input: {
  candidates: DiscoveredCandidate[];
  location: string;
  radiusKm: number;
  client: Anthropic;
  batching: Batching;
  onUsage?: UsageObserver;
}) {
  // `||`, not `??`: Vercel hands an env var that exists but is blank through as "", and the
  // batch API rejects `model: ""` for every request in the phase.
  const model = process.env.ANTHROPIC_TRIAGE_MODEL || DEFAULT_TRIAGE_MODEL;
  const excluded = new Map<number, string>();
  const messages: Anthropic.Message[] = [];
  const errors: { label: string; reason: string }[] = [];
  const slices: { offset: number; size: number; request: MessageRequest }[] = [];
  for (let offset = 0; offset < input.candidates.length; offset += 40) {
    const batch = input.candidates.slice(offset, offset + 40);
    slices.push({
      offset,
      size: batch.length,
      request: {
        options: triageRequestOptions,
        params: {
          model,
          max_tokens: 4_000,
          output_config: { format: zodOutputFormat(discoveryTriageSchema) },
          messages: [{
            role: "user",
            content: `Beoordeel op basis van alleen deze metadata welke kandidaten een webcontrole waard zijn voor een hotel in ${input.location} met een straal van ${input.radiusKm} km. Kies verify voor alles wat aannemelijk extra hotelovernachtingen veroorzaakt, en kies bij twijfel altijd verify. Kies exclude alleen met een categorie in excludeAs: artist_show voor een avond met een optredende artiest, band, dj of comedian; theatre_run voor een doorlopende theater- of bioscoopvoorstelling; market voor een waren-, rommel- of vintagemarkt; course voor een cursus of workshop. Zet bij elke exclude in act de woorden uit de titel die de categorie aantonen: bij artist_show de naam van de artiest, en bij de andere categorieën het woord of de merknaam waaruit de categorie blijkt. Neem die woorden letterlijk uit de titel over; kun je dat niet, kies dan verify. Een eigen merknaam zonder artiestennaam is een evenement en geen artist_show, ook als je de naam niet kent. Een competitiewedstrijd of professionele sportwedstrijd is nooit een exclude-categorie; kies dan verify. Geef voor elke index precies één beslissing met een korte reden. Kandidaten:\n${JSON.stringify(batch.map((candidate, index) => ({ index: offset + index, title: candidate.title, startDate: candidate.startDate, endDate: candidate.endDate, venue: candidate.venue, city: candidate.city, category: candidate.category })))}`,
          }],
        } satisfies MessageCreateParamsNonStreaming,
      },
    });
  }
  // Batched so a resumed run replays the same exclusions. A fresh triage verdict would rebuild
  // the verification queue, change its batch key, and pay for the whole phase twice.
  const results = await requestMessages(
    input.client,
    "triage",
    slices.map((slice) => slice.request),
    input.batching,
  );
  for (let index = 0; index < results.length; index += 1) {
    const { offset, size } = slices[index];
    const label = `<triage ${offset}-${offset + size - 1}>`;
    const result = results[index];
    if (result.status === "rejected") {
      errors.push({ label, reason: dropReason(result.reason) });
      continue;
    }
    const message = result.value;
    messages.push(message);
    await observeUsage(input.onUsage, usageEvent(message, "demand_triage", model));
    try {
      if (message.stop_reason === "max_tokens") {
        throw new Error("Claude triage reached its token limit.");
      }
      const text = message.content.find((block) => block.type === "text")?.text;
      if (!text) throw new Error("Claude triage returned no structured output.");
      discoveryTriageSchema.parse(JSON.parse(text)).reviews.forEach((review) => {
        const candidate = input.candidates[review.index];
        if (!candidate || review.index < offset || review.index >= offset + size) return;
        if (triageExclusionAllowed(review, candidate)) excluded.set(review.index, review.reason);
      });
    } catch (error) {
      errors.push({ label, reason: dropReason(error) });
    }
  }
  return { excluded, requests: slices.length, messages, errors };
}

function verificationInstructions(input: { start: string; end: string; location: string; radiusKm: number }) {
  return `Controleer titel, datum, locatie en status. Gebruik status active, cancelled of postponed. Neem maximaal één evenement op, alleen tussen ${input.start} en ${input.end} en binnen ${input.radiusKm} km van ${input.location}. Baseer je uitsluitend op de tekst van de pagina's die je met web_fetch hebt opgehaald; een zoekfragment kan verouderd zijn, dus als een fragment een eerdere editie noemt en de opgehaalde pagina de huidige data toont, gelden de data van de opgehaalde pagina. Geef als sourceUrl altijd de gewone pagina-URL zonder #-fragment en zonder #:~:text=. Als de opgehaalde pagina het evenement bevestigt maar de data van de huidige editie niet noemt, gebruik dan je tweede web_fetch op een andere officiële eigenaarspagina (gemeente, sportbond, locatie of ticketverkoper) die die data wel noemt. Een uitagenda, blog, wiki of zoekpagina telt daarvoor niet. Leid data nooit af uit een terugkerend patroon zoals "het tweede weekend van oktober"; zet dateConfirmed dan op false. Neem bij een meerdaagse huidige editie de eerste en laatste bevestigde datum over; maak van een bevestigde meerdaagse editie geen eendaagse 00:00-23:59-vermelding. Classificeer aantoonbare extra overnachtingsvraag voor hotels: 35 Medium, 45 High of 60 Piek. Geef alleen 45 High als de pagina meerdaagse duur, landelijke of internationale toestroom, of aantoonbaar grote bezoekersaantallen noemt; eenmalige avondprogrammering in een club, zaal of poppodium voor een lokaal of regionaal publiek is hooguit 35 Medium, ook als het woord festival in de naam staat. Gebruik alleen feiten over de huidige editie. Negeer cumulatieve bezoekersaantallen van eerdere edities en algemene marketingclaims. Gebruik null als de pagina geen geloofwaardig signaal bevat over regionaal, nationaal of internationaal bereik, bezoekersaantallen, meerdaagse duur, een laat programma of hotelvraag. Reserveer 60 Piek voor stadsbrede, meerdaagse, internationale of uitzonderlijk grote evenementen. Neem actieve evenementen met null of Low impact niet op. Geef een specifieke locatie zodat die gegeocodeerd kan worden. Gebruik ownerType other voor een agenda, blog, wiki, zoekpagina of andere pagina die de evenementinformatie niet bezit. Bepaal daarnaast overnightAudience: waar komt het publiek vandaan en moet het blijven slapen? Gebruik none als het publiek uit de stad zelf komt en na het programma naar huis gaat, regional als het publiek uit de omliggende provincie komt en binnen een uur naar huis rijdt, national als de pagina bezoekers uit heel Nederland aantoont, en international als de pagina buitenlandse bezoekers of deelnemers aantoont. Beoordeel dit los van impactPoints en los van de duur: een markt of familiefestival dat twee dagen achter elkaar van 10:00 tot 17:00 open is, trekt twee dagen dezelfde dagbezoekers en is dus none of regional, terwijl één avond die om 02:00 eindigt met een landelijke line-up national is. Een voorstelling in een stadstheater is none of regional tenzij de pagina landelijke toestroom aantoont. Gebruik null alleen als de pagina geen enkele aanwijzing over de herkomst van het publiek geeft.`;
}

function usageTotals(
  messages: Anthropic.Message[],
  failedFetches: number,
  completedSearches: number,
  plannedSearches: number,
) {
  return {
    inputTokens: messages.reduce((total, message) => total + usageEvent(message, "discovery", "").inputTokens, 0),
    outputTokens: messages.reduce((total, message) => total + usageEvent(message, "discovery", "").outputTokens, 0),
    webSearchRequests: messages.reduce(
      (total, message) => total + usageEvent(message, "discovery", "").webSearchRequests,
      0,
    ),
    webFetchRequests: messages.reduce(
      (total, message) => total + usageEvent(message, "discovery", "").webFetchRequests,
      0,
    ),
    failedFetches,
    completedSearches,
    plannedSearches,
  };
}

type MarketCache = {
  load: (input: ClaudeMarketInput) => Promise<SourceResult | null>;
  save: (input: ClaudeMarketInput, result: SourceResult) => Promise<void>;
};

type CollectClaudeInput = CollectionWindow & {
  location: string;
  radiusKm: number;
  model?: string;
  discoveryModel?: string;
  client?: Anthropic;
  onUsage?: UsageObserver;
  geocode?: (query: string) => Promise<{ latitude: number; longitude: number } | null>;
  triage?: (candidates: DiscoveredCandidate[]) => Promise<Map<number, string>>;
  knownUrls?: string[];
  // Injecting a client used to disable batching, which left the resume path — the whole reason
  // batches exist here — with no way to be exercised outside production.
  batching?: Batching;
  marketCache?: MarketCache;
};

/**
 * Failed page fetches are the steady state of this pipeline, not a defect, so gating sharing on
 * them left the city cache empty for every production run. What must never be shared is a run
 * that skipped a month/category slice, because whole categories would be missing from the city.
 */
export function marketResultIsShareable(usage: Record<string, number>) {
  return usage.plannedSearches > 0 && usage.completedSearches === usage.plannedSearches;
}

export async function collectClaude(input: CollectClaudeInput): Promise<SourceResult> {
  const model = input.model ?? process.env.ANTHROPIC_MODEL;
  if (!model) throw new Error("ANTHROPIC_MODEL is required for the Claude source.");
  const discoveryModel = input.discoveryModel ?? (process.env.ANTHROPIC_DISCOVERY_MODEL || model);
  const client = input.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const batching: Batching = input.batching
    ?? { enabled: !input.client && process.env.ANTHROPIC_BATCHES !== "disabled" };
  const marketCache = input.marketCache
    ?? { load: loadClaudeMarketResult, save: saveClaudeMarketResult };
  const market = {
    start: input.start,
    end: input.end,
    location: input.location,
    radiusKm: input.radiusKm,
    model,
    discoveryModel,
    knownUrls: input.knownUrls ?? [],
  };
  if (batching.enabled) {
    const cached = await marketCache.load(market);
    if (cached) return cached;
  }
  const result = await collectClaudeFresh(input, model, discoveryModel, client, batching);
  if (batching.enabled && marketResultIsShareable(result.usage)) {
    await marketCache.save(market, result);
  }
  return result;
}

async function collectClaudeFresh(
  input: CollectClaudeInput,
  model: string,
  discoveryModel: string,
  client: Anthropic,
  batching: Batching,
): Promise<SourceResult> {
  const userLocation = {
    type: "approximate" as const,
    country: "NL",
    city: input.location,
    timezone: "Europe/Amsterdam",
  };
  const drops: DiscoveryDrop[] = [];
  const recordDrop = (title: string, stage: DiscoveryDrop["stage"], reason: string) => {
    if (drops.length < 50) drops.push({ title, stage, reason });
  };

  const searches: Anthropic.Message[] = [];
  const discovered: DiscoveredCandidate[] = [];
  const foundAgendaUrls: string[] = [];
  let parsedSearches = 0;
  let firstFailure: unknown;
  const searchTasks = searchWindows(input.start, input.end).flatMap((window) => {
    const month = monthLabels(window.start);
    return searchGroups.map((group) => {
      const focus = group.focus;
      const searchQuery = group.query(input.location, month);
      return {
        window,
        focus,
        request: {
          options: searchRequestOptions,
          params: {
            model: discoveryModel,
            max_tokens: 2_500,
            ...(discoveryModel.startsWith("claude-sonnet-5")
              ? { thinking: { type: "disabled" as const } }
              : {}),
            tools: [{
              type: "web_search_20260318",
              name: "web_search",
              allowed_callers: ["direct"],
              max_uses: 1,
              response_inclusion: "full",
              user_location: userLocation,
            }],
            // No tool_choice: forcing web_search leaves the model unable to emit the
            // output_config text block, so the request returns tool blocks only.
            output_config: { format: zodOutputFormat(discoverySchema) },
            messages: [{
              role: "user",
              content: `Voer eerst precies één web_search uit en antwoord nooit zonder zoekresultaten. Zoek evenementen binnen ${input.radiusKm} km van ${input.location} tussen ${window.start} en ${window.end}: ${focus}. Gebruik als zoekopdracht exact "${searchQuery}" en verzin geen andere zoekopdracht. Gebruik uitagenda's, toeristische kalenders, ticketlijsten en overzichtspagina's om namen van evenementen te leren; dat mag in deze stap. Geef per evenement de naam, begindatum en einddatum als YYYY-MM-DD, de plaats, de locatie en de officiële pagina van de organisator, locatie, club, federatie, universiteit of gemeente als die in de zoekresultaten staat. Verzin geen URL's en neem alleen URL's over die letterlijk in de zoekresultaten voorkomen; gebruik null als je de officiële pagina niet ziet. Geef maximaal zes evenementen die aannemelijk extra hotelovernachtingen veroorzaken en sla markten, wekelijkse activiteiten en kleine lokale programmering over. Geef daarnaast maximaal twee agendapagina's met het volledigste programma voor deze periode; kies bij voorkeur de agenda van een concrete zaal, poppodium, congrescentrum, stadion of organisator boven een breed stadsportaal of een landelijke zoeksite, omdat die laatste vaak niet op te halen zijn. Geef daarna je antwoord in het gevraagde JSON-formaat.`,
            }],
          } satisfies MessageCreateParamsNonStreaming,
        },
      };
    });
  });
  const searchResults = await requestMessages(
    client,
    "search",
    searchTasks.map((task) => task.request),
    batching,
  );
  for (let index = 0; index < searchResults.length; index += 1) {
    const result = searchResults[index];
    const task = searchTasks[index];
    try {
      if (result.status === "rejected") throw result.reason;
      const search = result.value;
      searches.push(search);
      await observeUsage(input.onUsage, usageEvent(search, "discovery", discoveryModel));
      if (search.usage.server_tool_use?.web_search_requests !== 1) {
        throw new Error("Claude discovery did not execute its required web search.");
      }
      if (search.stop_reason === "max_tokens") {
        throw new Error("Claude discovery reached its token limit.");
      }
      const text = search.content.find((block) => block.type === "text")?.text;
      if (!text) throw new Error(`Claude discovery returned no structured output (stop_reason: ${search.stop_reason}).`);
      const parsed = discoverySchema.parse(JSON.parse(text));
      parsedSearches += 1;
      const observed = sourceUrls(search);
      parsed.candidates.slice(0, 6).forEach((candidate) => discovered.push({
        ...candidate,
        officialUrl: observedUrl(candidate.officialUrl, observed) ? candidate.officialUrl : null,
      }));
      foundAgendaUrls.push(...parsed.agendaUrls.filter((url) => observedUrl(url, observed)));
    } catch (error) {
      firstFailure ??= error;
      recordDrop(`<${task.focus} ${task.window.start}>`, "discovery", dropReason(error));
    }
  }
  if (!parsedSearches && firstFailure) throw firstFailure;

  const agendaTargets: string[] = [];
  const seenAgendaKeys = new Set<string>();
  const venueAgendas = discovered.flatMap((candidate) =>
    candidate.officialUrl ? [parentPath(candidate.officialUrl)] : [],
  ).filter((url): url is string => Boolean(url));
  // A venue whose agenda paid off once keeps paying off - its listing carries next month's
  // programme. Derive roots from already-confirmed URLs too, so the channel survives a week
  // where no search happens to surface that venue.
  const knownAgendas = (input.knownUrls ?? [])
    .map((url) => parentPath(url))
    .filter((url): url is string => Boolean(url));
  // A listing a candidate claims as its official page is still a listing:
  // harvest it here rather than letting verification reject it as ownerType other.
  for (const url of [...venueAgendas, ...foundAgendaUrls, ...knownAgendas]) {
    const key = comparableUrl(url);
    if (seenAgendaKeys.has(key)) continue;
    seenAgendaKeys.add(key);
    agendaTargets.push(url);
    if (agendaTargets.length === 8) break;
  }

  const agendaMessages: Anthropic.Message[] = [];
  let failedFetches = 0;
  const agendaResults = await requestMessages(
    client,
    "agenda",
    agendaTargets.map((url) => ({
      options: verificationRequestOptions,
      params: {
        model: discoveryModel,
        max_tokens: 2_500,
        ...(discoveryModel.startsWith("claude-sonnet-5")
          ? { thinking: { type: "disabled" as const } }
          : {}),
        tools: [{
          type: "web_fetch_20260318",
          name: "web_fetch",
          allowed_callers: ["direct"],
          max_uses: 1,
          max_content_tokens: 6_000,
          citations: { enabled: false },
          response_inclusion: "full",
        }],
        output_config: { format: zodOutputFormat(discoverySchema) },
        messages: [{
          role: "user",
          content: `Open deze agendapagina en noteer welke evenementen tussen ${input.start} en ${input.end} binnen ${input.radiusKm} km van ${input.location} plaatsvinden. Geef per evenement de naam, begindatum en einddatum als YYYY-MM-DD, de plaats, de locatie en de officiële pagina waarnaar de agenda linkt als die op de pagina staat; gebruik anders null. Verzin geen URL's. Geef maximaal tien evenementen die aannemelijk extra hotelovernachtingen veroorzaken en sla markten, wekelijkse activiteiten en kleine lokale programmering over. Geef een lege lijst agendaUrls. Pagina:\n${url}`,
        }],
      } satisfies MessageCreateParamsNonStreaming,
    })),
    batching,
  );
  for (let index = 0; index < agendaResults.length; index += 1) {
    const result = agendaResults[index];
    try {
      if (result.status === "rejected") throw result.reason;
      const message = result.value;
      agendaMessages.push(message);
      await observeUsage(input.onUsage, usageEvent(message, "discovery_fetch", discoveryModel));
      if (message.usage.server_tool_use?.web_fetch_requests !== 1) {
        throw new Error("Claude agenda fetch did not execute its required web fetch.");
      }
      if (message.stop_reason === "max_tokens") {
        throw new Error("Claude agenda fetch reached its token limit.");
      }
      const text = message.content.find((block) => block.type === "text")?.text;
      if (!text) throw new Error("Claude agenda fetch returned no structured output.");
      discovered.push(...discoverySchema.parse(JSON.parse(text)).candidates.slice(0, 10));
    } catch (error) {
      failedFetches += 1;
      recordDrop(agendaTargets[index], "discovery", dropReason(error));
    }
  }

  const identityTokens = (title: string) =>
    normalizeText(title).split(" ").filter((token) => token && !/^20\d{2}$/.test(token));
  const sameIdentity = (left: DiscoveredCandidate, right: DiscoveredCandidate) => {
    const leftTokens = identityTokens(left.title);
    const rightTokens = identityTokens(right.title);
    if (!leftTokens.length || !rightTokens.length) return false;
    if (leftTokens[0] !== rightTokens[0]) return false;
    const [shorter, longer] = leftTokens.length <= rightTokens.length
      ? [leftTokens, rightTokens]
      : [rightTokens, leftTokens];
    if (!shorter.every((token) => longer.includes(token))) return false;
    return left.startDate <= (right.endDate ?? right.startDate)
      && right.startDate <= (left.endDate ?? left.startDate);
  };
  const pool: DiscoveredCandidate[] = [];
  for (const candidate of discovered) {
    const existing = pool.find((entry) => sameIdentity(entry, candidate));
    if (!existing) {
      pool.push({ ...candidate });
      continue;
    }
    if (!existing.officialUrl && candidate.officialUrl) existing.officialUrl = candidate.officialUrl;
    if (identityTokens(candidate.title).length < identityTokens(existing.title).length) {
      existing.title = candidate.title;
    }
    if (candidate.startDate < existing.startDate) existing.startDate = candidate.startDate;
    const candidateEnd = candidate.endDate ?? candidate.startDate;
    if (candidateEnd > (existing.endDate ?? existing.startDate)) existing.endDate = candidateEnd;
  }
  const namesDiscovered = pool.length;
  const inWindow = pool.filter((candidate) => {
    if (candidate.startDate > input.end || (candidate.endDate ?? candidate.startDate) < input.start) {
      recordDrop(candidate.title, "discovery", "Buiten het verzamelvenster.");
      return false;
    }
    return true;
  });
  const triage = input.triage
    ? { excluded: await input.triage(inWindow), requests: 0, messages: [] as Anthropic.Message[], errors: [] }
    : await triageDiscoveries({
      candidates: inWindow,
      location: input.location,
      radiusKm: input.radiusKm,
      client,
      batching,
      onUsage: input.onUsage,
    });
  // A silent triage failure sends every candidate to the expensive verification stage and looks
  // exactly like a run where nothing deserved excluding. Name it so source health shows it.
  triage.errors.forEach(({ label, reason }) => recordDrop(label, "triage", reason));
  const urlEntries: VerificationEntry[] = [];
  const nameEntries: VerificationEntry[] = [];
  inWindow.forEach((candidate, index) => {
    const rejected = triage.excluded.get(index);
    if (rejected !== undefined) {
      recordDrop(candidate.title, "triage", rejected || "Geen aannemelijke hotelvraag op basis van de metadata.");
      return;
    }
    const entry: VerificationEntry = {
      title: candidate.title,
      startDate: candidate.startDate,
      venue: candidate.venue,
      city: candidate.city,
      officialUrl: candidate.officialUrl,
      search: false,
    };
    (candidate.officialUrl ? urlEntries : nameEntries).push(entry);
  });

  const pending: VerificationEntry[] = [
    ...urlEntries,
    ...nameEntries,
    ...(input.knownUrls ?? []).slice(0, 8).map((url) => ({
      title: null,
      startDate: null,
      venue: null,
      city: null,
      officialUrl: url,
      search: false,
    })),
  ];
  const queue: VerificationEntry[] = [];
  const queuedUrlKeys = new Set<string>();
  let searchBudget = 20;
  for (const entry of pending) {
    if (entry.officialUrl) {
      const key = comparableUrl(entry.officialUrl);
      if (queuedUrlKeys.has(key)) continue;
      queuedUrlKeys.add(key);
    }
    if (queue.length === 40) {
      recordDrop(entry.title ?? entry.officialUrl ?? "", "resolution", "Verificatiebudget van 40 kandidaten bereikt.");
      continue;
    }
    if (!entry.officialUrl) {
      if (!searchBudget) {
        recordDrop(entry.title ?? "", "resolution", "Zoekbudget voor officiële pagina's bereikt.");
        continue;
      }
      searchBudget -= 1;
      entry.search = true;
    }
    queue.push(entry);
  }
  if (!queue.length) {
    return {
      source: "claude",
      candidates: [],
      requests: searches.length + agendaTargets.length + triage.requests,
      usage: usageTotals(
        [...searches, ...agendaMessages, ...triage.messages],
        failedFetches,
        parsedSearches,
        searchTasks.length,
      ),
      funnel: { namesDiscovered, urlsResolved: 0, pagesVerified: 0, demandAccepted: 0, drops },
    };
  }

  const verified: { entry: VerificationEntry; message: Anthropic.Message }[] = [];
  const fetched = (message: Anthropic.Message) =>
    (message.usage.server_tool_use?.web_fetch_requests ?? 0) >= 1;
  const verificationRequest = (entry: VerificationEntry, retry: boolean): MessageRequest => {
    const tools: NonNullable<Anthropic.MessageCreateParams["tools"]> = [{
        type: "web_fetch_20260318",
        name: "web_fetch",
        allowed_callers: ["direct"],
        max_uses: 2,
        max_content_tokens: 6_000,
        citations: { enabled: false },
        response_inclusion: "full",
    }];
    if (entry.search) {
      tools.push({
          type: "web_search_20260318",
          name: "web_search",
          allowed_callers: ["direct"],
          max_uses: 1,
          response_inclusion: "full",
          user_location: userLocation,
      });
    }
    const prompt = entry.officialUrl
      ? `Open deze specifieke officiële evenementpagina. ${verificationInstructions(input)} Pagina:\n${entry.officialUrl}`
      : `Zoek met één zoekopdracht de officiële pagina van dit evenement en open die pagina: ${entry.title}, ${entry.startDate}${entry.venue ? `, ${entry.venue}` : ""}, ${entry.city}. Een uitagenda, blog, ticketaggregator of zoekpagina is geen officiële pagina. ${verificationInstructions(input)}`;
    return {
      options: verificationRequestOptions,
      params: {
          model,
          max_tokens: 2_000,
          ...(model.startsWith("claude-sonnet-5")
            ? { thinking: { type: "disabled" as const } }
            : {}),
          tools,
          output_config: { format: zodOutputFormat(outputSchema) },
          messages: [{
            role: "user",
            content: retry
              ? `Je vorige antwoord gebruikte geen web_fetch en is daarom verworpen. Haal de pagina eerst op met web_fetch en antwoord pas daarna. ${prompt}`
              : prompt,
          }],
      },
    };
  };
  const settled = await requestMessages(
    client,
    "verification",
    queue.map((entry) => verificationRequest(entry, false)),
    batching,
  );
  const retryIndexes: number[] = [];
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    if (result.status === "fulfilled") {
      await observeUsage(input.onUsage, usageEvent(result.value, "discovery_fetch", model));
      if (!fetched(result.value)) retryIndexes.push(index);
    }
  }
  if (retryIndexes.length) {
    const retries = await requestMessages(
      client,
      "verification",
      retryIndexes.map((index) => verificationRequest(queue[index], true)),
      batching,
    );
    for (let index = 0; index < retries.length; index += 1) {
      const retry = retries[index];
      const originalIndex = retryIndexes[index];
      settled[originalIndex] = retry;
      if (retry.status === "fulfilled") {
        await observeUsage(input.onUsage, usageEvent(retry.value, "discovery_fetch", model));
      }
    }
  }
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    const entry = queue[index];
    if (result.status === "fulfilled" && fetched(result.value)) {
      verified.push({ entry, message: result.value });
    } else {
      const reason = result.status === "rejected"
        ? result.reason
        : new Error("Claude verification did not execute its required web fetch.");
      failedFetches += 1;
      firstFailure ??= reason;
      recordDrop(entry.title ?? entry.officialUrl ?? "", "verification", `Fetch mislukt: ${dropReason(reason)}`);
    }
  }
  if (!verified.length && firstFailure) throw firstFailure;

  let parsedFetches = 0;
  let urlsResolved = 0;
  let pagesVerified = 0;
  const events = verified.flatMap(({ entry, message }) => {
    const label = entry.title ?? entry.officialUrl ?? "";
    try {
      if (message.stop_reason === "max_tokens") {
        throw new Error("Claude verification reached its token limit.");
      }
      const text = message.content.find((block) => block.type === "text")?.text;
      if (!text) throw new Error("Claude verification returned no structured output.");
      const observed = fetchedUrls(message);
      const parsed = outputSchema.parse(JSON.parse(text));
      parsedFetches += 1;
      return parsed.events.flatMap((event) => {
        const sourceUrl = stripFragment(supportedObservedUrl(
          event.sourceUrl,
          event.evidenceText ?? "",
          observed,
        ));
        if (!sourceUrl) {
          recordDrop(label, "verification", "Geen gefetchte officiële URL.");
          return [];
        }
        urlsResolved += 1;
        const primarySourceConfirmed =
          ownerTypes.includes(event.ownerType as (typeof ownerTypes)[number]) &&
          event.titleConfirmed &&
          event.dateConfirmed &&
          event.locationConfirmed;
        if (primarySourceConfirmed) pagesVerified += 1;
        else if (event.ownerType !== "other") {
          const missing = [
            !event.titleConfirmed && "titel",
            !event.dateConfirmed && "datum",
            !event.locationConfirmed && "locatie",
          ].filter(Boolean).join(", ");
          recordDrop(
            label,
            "verification",
            `Niet bevestigd op ${sourceUrl} (ontbreekt: ${missing || "onbekend"}, ownerType ${event.ownerType}).`,
          );
        }
        if (event.ownerType === "other") {
          recordDrop(label, "verification", "Pagina is geen eigenaarspagina (ownerType other).");
          return [];
        }
        if (event.status === "active" && ![35, 45, 60].includes(event.impactPoints ?? 0)) {
          recordDrop(label, "verification", `Geen aantoonbare hotelvraag (impactPoints ${event.impactPoints}).`);
          return [];
        }
        return [{ ...event, sourceUrl, primarySourceConfirmed }];
      });
    } catch (error) {
      failedFetches += 1;
      firstFailure ??= error;
      recordDrop(
        label,
        "verification",
        message.stop_reason === "max_tokens" ? "Tokenlimiet bereikt." : "Ongeldige structured output.",
      );
      return [];
    }
  });
  if (!parsedFetches && firstFailure) throw firstFailure;
  const geocode = input.geocode ?? geocodeVenue;
  const candidates = await Promise.all(events.map(async (event) => {
    const resolved = event.latitude === null || event.longitude === null
      ? event.venue ? await geocode(`${event.venue}, ${input.location}`) : null
      : null;
    const candidate = {
      provider: "claude" as const,
      providerEventId: "",
      sourceUrl: event.sourceUrl,
      title: event.title,
      category: event.category,
      venue: event.venue,
      latitude: event.latitude ?? resolved?.latitude ?? null,
      longitude: event.longitude ?? resolved?.longitude ?? null,
      regionScope: event.regionScope,
      startAt: event.startAt,
      endAt: event.endAt,
      sourceState: event.status,
      certainty: "confirmed" as const,
      localRank: null,
      attendance: null,
      venueCapacity: null,
      aiImpactPoints: event.impactPoints,
      overnightAudience: event.overnightAudience,
      evidenceText: event.evidenceText,
      primarySourceConfirmed: event.primarySourceConfirmed,
    } satisfies EventCandidate;
    candidate.providerEventId = claudeProviderEventId(candidate);
    return candidate;
  }));

  return {
    source: "claude",
    candidates,
    requests: searches.length + agendaTargets.length + triage.requests + queue.length,
    usage: usageTotals(
      [...searches, ...agendaMessages, ...triage.messages, ...verified.map(({ message }) => message)],
      failedFetches,
      parsedSearches,
      searchTasks.length,
    ),
    funnel: {
      namesDiscovered,
      urlsResolved,
      pagesVerified,
      demandAccepted: candidates.filter((candidate) => (candidate.aiImpactPoints ?? 0) >= 45).length,
      drops,
    },
  };
}

export async function triagePredictHqCandidates(input: {
  candidates: EventCandidate[];
  hotelName: string;
  location: string;
  radiusKm: number;
  distancesKm?: Record<string, number>;
  model?: string;
  client?: Anthropic;
  onUsage?: UsageObserver;
}): Promise<{ reviews: DemandTriage[]; requests: number; usage: Record<string, number> }> {
  const model = input.model || process.env.ANTHROPIC_TRIAGE_MODEL || DEFAULT_TRIAGE_MODEL;
  const client = input.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const batches: EventCandidate[][] = [];
  for (let index = 0; index < input.candidates.length; index += 40) batches.push(input.candidates.slice(index, index + 40));

  const messages: Anthropic.Message[] = [];
  for (const batch of batches) {
    const message = await requestPhase("verification", () => client.messages.create({
      model,
      max_tokens: 5_000,
      output_config: { format: zodOutputFormat(demandTriageSchema) },
      messages: [{
        role: "user",
        content: `Classificeer elk PredictHQ-kandidaat voor ${input.hotelName} in ${input.location}, binnen ${input.radiusKm} km. Gebruik alleen de metadata hieronder en doe geen aannames over feitelijke bevestiging. De afstandKm is door de applicatie berekend; schat de afstand niet zelf. Kies exclude voor lokale, kleine of terugkerende activiteiten zonder aannemelijke extra overnachtingsvraag. Kies verify alleen voor actieve evenementen met waarschijnlijke High/Piek hotelvraag die een webcontrole waard zijn. Kies provisional voor Medium-signalen en voor sterke voorspelde evenementen. Voorspelde evenementen mogen nooit verify krijgen. Geef voor ieder ID precies een korte beslissing. Kandidaten:\n${JSON.stringify(batch.map((candidate) => ({ id: candidate.providerEventId, title: candidate.title, category: candidate.category, state: candidate.sourceState, startAt: candidate.startAt, endAt: candidate.endAt, attendance: candidate.attendance, localRank: candidate.localRank, venue: candidate.venue, distanceKm: input.distancesKm?.[candidate.providerEventId] ?? null })))}`,
      }],
    }, triageRequestOptions));
    await observeUsage(input.onUsage, usageEvent(message, "demand_triage", model));
    messages.push(message);
  }

  const reviews: DemandTriage[] = [];
  messages.forEach((message, index) => {
    if (message.stop_reason === "max_tokens") throw new Error("Claude demand triage reached its token limit.");
    const text = message.content.find((block) => block.type === "text")?.text;
    if (!text) throw new Error("Claude demand triage returned no structured output.");
    const parsed = demandTriageSchema.parse(JSON.parse(text));
    const expected = new Set(batches[index].map((candidate) => candidate.providerEventId));
    const byId = new Map(parsed.reviews.filter((review) => expected.has(review.providerEventId)).map((review) => [review.providerEventId, review]));

    batches[index].forEach((candidate) => {
      const review = byId.get(candidate.providerEventId);
      if (!review || review.confidence === "low" || review.demandLevel === "low") {
        reviews.push({
          providerEventId: candidate.providerEventId,
          decision: "exclude",
          confidence: review?.confidence ?? "low",
          demandLevel: review?.demandLevel ?? "low",
          evidenceText: review?.evidenceText ?? "Geen aannemelijk effect op de hotelvraag.",
        });
        return;
      }
      const decision = candidate.sourceState === "predicted"
        ? "provisional"
        : review.demandLevel === "high" || review.demandLevel === "peak"
          ? "verify"
          : "provisional";
      reviews.push({
        providerEventId: candidate.providerEventId,
        decision,
        confidence: review.confidence,
        demandLevel: review.demandLevel,
        evidenceText: review.evidenceText,
      });
    });
  });

  return {
    reviews,
    requests: messages.length,
    usage: {
      inputTokens: messages.reduce((total, message) => total + message.usage.input_tokens, 0),
      outputTokens: messages.reduce((total, message) => total + message.usage.output_tokens, 0),
      webSearchRequests: 0,
      webFetchRequests: 0,
    },
  };
}

export async function verifyPredictHqCandidates(input: {
  candidates: EventCandidate[];
  hotelName: string;
  location: string;
  radiusKm: number;
  model?: string;
  client?: Anthropic;
  onUsage?: UsageObserver;
}): Promise<{ reviews: EvidenceReview[]; requests: number; usage: Record<string, number> }> {
  const model = input.model ?? process.env.ANTHROPIC_MODEL;
  if (!model) throw new Error("ANTHROPIC_MODEL is required for Claude demand verification.");
  const client = input.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const candidates = input.candidates.slice(0, 10);
  const messages: Anthropic.Message[] = [];

  for (const candidate of candidates) {
    const message = await requestPhase("verification", () => client.messages.create({
      model,
      max_tokens: 1_000,
      ...(model.startsWith("claude-sonnet-5")
        ? { thinking: { type: "disabled" as const } }
        : {}),
      tools: [
        { type: "web_search_20260318", name: "web_search", allowed_callers: ["direct"], max_uses: 1, response_inclusion: "full", user_location: { type: "approximate", country: "NL", city: input.location, timezone: "Europe/Amsterdam" } },
      ],
      output_config: { format: zodOutputFormat(evidenceReviewSchema) },
      messages: [{
        role: "user",
        content: `Controleer dit actieve PredictHQ-evenement voor ${input.hotelName} in ${input.location}. Zoek maximaal één openbare primaire bron van de organisator, locatie, sportbond, club of ticketverkoper. Kies sourceUrl exact uit de zoekresultaten. Markeer verified alleen als titel, datum en locatie overeenkomen. Geef unverifiable als geen primaire bron binnen deze ene zoekpoging gevonden wordt. Kandidaat:\n${JSON.stringify({ id: candidate.providerEventId, title: candidate.title, category: candidate.category, startAt: candidate.startAt, endAt: candidate.endAt, attendance: candidate.attendance, localRank: candidate.localRank, venue: candidate.venue })}`,
      }],
    }, verificationRequestOptions));
    await observeUsage(input.onUsage, usageEvent(message, "demand_verification", model));
    messages.push(message);
  }

  const reviews: EvidenceReview[] = messages.map((message, index) => {
    const candidate = candidates[index];
    if (message.stop_reason === "max_tokens") throw new Error("Claude demand verification reached its token limit.");
    const text = message.content.find((block) => block.type === "text")?.text;
    if (!text) throw new Error("Claude demand verification returned no structured output.");
    const review = evidenceReviewSchema.parse(JSON.parse(text));
    const observed = sourceUrls(message);
    const supportedUrl = supportedObservedUrl(review.sourceUrl, review.evidenceText, observed);
    const supported = review.providerEventId === candidate.providerEventId
      && review.decision === "verified"
      && review.confidence !== "low"
      && ownerTypes.includes(review.ownerType as (typeof ownerTypes)[number])
      && review.titleConfirmed && review.dateConfirmed && review.locationConfirmed
      && Boolean(supportedUrl);
    return supported ? {
      providerEventId: candidate.providerEventId,
      decision: "verified",
      confidence: review.confidence,
      sourceUrl: supportedUrl,
      evidenceText: review.evidenceText,
    } : {
      providerEventId: candidate.providerEventId,
      decision: "unverifiable",
      confidence: review.confidence,
      sourceUrl: null,
      evidenceText: review.evidenceText || "Geen controleerbare primaire bron gevonden.",
    };
  });

  return {
    reviews,
    requests: messages.length,
    usage: {
      inputTokens: messages.reduce((total, message) => total + message.usage.input_tokens, 0),
      outputTokens: messages.reduce((total, message) => total + message.usage.output_tokens, 0),
      webSearchRequests: messages.reduce((total, message) => total + (message.usage.server_tool_use?.web_search_requests ?? 0), 0),
      webFetchRequests: messages.reduce((total, message) => total + (message.usage.server_tool_use?.web_fetch_requests ?? 0), 0),
    },
  };
}


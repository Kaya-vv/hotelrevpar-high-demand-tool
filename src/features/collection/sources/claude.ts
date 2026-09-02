import Anthropic, { APIConnectionTimeoutError } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { createHash } from "node:crypto";
import { z } from "zod";

import type { DemandTriage, EvidenceReview } from "@/features/events/hotel-demand";
import { normalizeText } from "@/features/events/normalize";
import type { EventCandidate } from "@/features/events/types";
import { getAddressById, searchAddresses } from "@/features/portfolio/geocode";

import type { CollectionWindow, DiscoveryDrop, SourceResult } from "../types";

const ownerTypes = ["organizer", "venue", "club", "federation", "ticket_provider", "university", "municipality", "event_owner"] as const;
const searchRequestOptions = { timeout: 180_000, maxRetries: 1 } as const;
const verificationRequestOptions = { timeout: 180_000, maxRetries: 0 } as const;
const triageRequestOptions = { timeout: 90_000, maxRetries: 0 } as const;

export type ClaudeUsageEvent = {
  phase: "discovery" | "discovery_fetch" | "demand_triage" | "demand_verification";
  model: string;
  inputTokens: number;
  outputTokens: number;
  webSearchRequests: number;
  webFetchRequests: number;
};

type UsageObserver = (usage: ClaudeUsageEvent) => void | Promise<void>;
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

async function requestPhase<T>(phase: "search" | "agenda" | "verification", request: () => Promise<T>) {
  try {
    return await request();
  } catch (error) {
    if (error instanceof APIConnectionTimeoutError) throw new Error(`Claude ${phase} timed out.`);
    throw error;
  }
}

function usageEvent(message: Anthropic.Message, phase: ClaudeUsageEvent["phase"], model: string): ClaudeUsageEvent {
  return {
    phase,
    model,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    webSearchRequests: message.usage.server_tool_use?.web_search_requests ?? 0,
    webFetchRequests: message.usage.server_tool_use?.web_fetch_requests ?? 0,
  };
}

async function observeUsage(observer: UsageObserver | undefined, event: ClaudeUsageEvent) {
  if (observer) await observer(event);
}

const searchGroups = [
  "stadsbrede festivals, design weeks en marathons",
  "congressen, tentoonstellingen, vakbeurzen en conferenties",
  "grote concerten en meerdaagse entertainment-evenementen",
  "bevestigde professionele sportwedstrijden en sporttoernooien",
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

function verificationInstructions(input: { start: string; end: string; location: string; radiusKm: number }) {
  return `Controleer titel, datum, locatie en status. Gebruik status active, cancelled of postponed. Neem maximaal één evenement op, alleen tussen ${input.start} en ${input.end} en binnen ${input.radiusKm} km van ${input.location}. Baseer je uitsluitend op de tekst van de pagina's die je met web_fetch hebt opgehaald; een zoekfragment kan verouderd zijn, dus als een fragment een eerdere editie noemt en de opgehaalde pagina de huidige data toont, gelden de data van de opgehaalde pagina. Geef als sourceUrl altijd de gewone pagina-URL zonder #-fragment en zonder #:~:text=. Als de opgehaalde pagina het evenement bevestigt maar de data van de huidige editie niet noemt, gebruik dan je tweede web_fetch op een andere officiële eigenaarspagina (gemeente, sportbond, locatie of ticketverkoper) die die data wel noemt. Een uitagenda, blog, wiki of zoekpagina telt daarvoor niet. Leid data nooit af uit een terugkerend patroon zoals "het tweede weekend van oktober"; zet dateConfirmed dan op false. Neem bij een meerdaagse huidige editie de eerste en laatste bevestigde datum over; maak van een bevestigde meerdaagse editie geen eendaagse 00:00-23:59-vermelding. Classificeer aantoonbare extra overnachtingsvraag voor hotels: 35 Medium, 45 High of 60 Piek. Gebruik alleen feiten over de huidige editie. Negeer cumulatieve bezoekersaantallen van eerdere edities en algemene marketingclaims. Gebruik null als de pagina geen geloofwaardig signaal bevat over regionaal, nationaal of internationaal bereik, bezoekersaantallen, meerdaagse duur, een laat programma of hotelvraag. Reserveer 60 Piek voor stadsbrede, meerdaagse, internationale of uitzonderlijk grote evenementen. Neem actieve evenementen met null of Low impact niet op. Geef een specifieke locatie zodat die gegeocodeerd kan worden. Gebruik ownerType other voor een agenda, blog, wiki, zoekpagina of andere pagina die de evenementinformatie niet bezit.`;
}

function usageTotals(messages: Anthropic.Message[], failedFetches: number) {
  return {
    inputTokens: messages.reduce((total, message) => total + message.usage.input_tokens, 0),
    outputTokens: messages.reduce((total, message) => total + message.usage.output_tokens, 0),
    webSearchRequests: messages.reduce(
      (total, message) => total + (message.usage.server_tool_use?.web_search_requests ?? 0),
      0,
    ),
    webFetchRequests: messages.reduce(
      (total, message) => total + (message.usage.server_tool_use?.web_fetch_requests ?? 0),
      0,
    ),
    failedFetches,
  };
}

export async function collectClaude(
  input: CollectionWindow & {
    location: string;
    radiusKm: number;
    model?: string;
    discoveryModel?: string;
    client?: Anthropic;
    onUsage?: UsageObserver;
    geocode?: (query: string) => Promise<{ latitude: number; longitude: number } | null>;
    knownUrls?: string[];
  },
): Promise<SourceResult> {
  const model = input.model ?? process.env.ANTHROPIC_MODEL;
  if (!model) throw new Error("ANTHROPIC_MODEL is required for the Claude source.");
  const discoveryModel = input.discoveryModel ?? (process.env.ANTHROPIC_DISCOVERY_MODEL || model);
  const client = input.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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
  for (const window of searchWindows(input.start, input.end)) {
    const monthLabel = dutchMonthFormat.format(new Date(`${window.start}T00:00:00Z`));
    for (const focus of searchGroups) {
      try {
        const search = await requestPhase("search", () => client.messages.create({
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
            content: `Voer eerst precies één web_search uit en antwoord nooit zonder zoekresultaten. Zoek evenementen binnen ${input.radiusKm} km van ${input.location} tussen ${window.start} en ${window.end}: ${focus}. Formuleer je zoekopdracht in het Nederlands met de stad en de maand, bijvoorbeeld "evenementen ${input.location} ${monthLabel}". Gebruik uitagenda's, toeristische kalenders, ticketlijsten en overzichtspagina's om namen van evenementen te leren; dat mag in deze stap. Geef per evenement de naam, begindatum en einddatum als YYYY-MM-DD, de plaats, de locatie en de officiële pagina van de organisator, locatie, club, federatie, universiteit of gemeente als die in de zoekresultaten staat. Verzin geen URL's en neem alleen URL's over die letterlijk in de zoekresultaten voorkomen; gebruik null als je de officiële pagina niet ziet. Geef maximaal zes evenementen die aannemelijk extra hotelovernachtingen veroorzaken en sla markten, wekelijkse activiteiten en kleine lokale programmering over. Geef daarnaast maximaal twee agenda- of overzichtspagina's die het volledigste programma voor deze periode lijken te bevatten. Geef daarna je antwoord in het gevraagde JSON-formaat.`,
          }],
        }, searchRequestOptions));
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
        recordDrop(`<${focus} ${window.start}>`, "discovery", dropReason(error));
      }
    }
  }
  if (!parsedSearches && firstFailure) throw firstFailure;

  const officialKeys = new Set(discovered.flatMap((candidate) =>
    candidate.officialUrl ? [comparableUrl(candidate.officialUrl)] : [],
  ));
  const agendaTargets: string[] = [];
  const seenAgendaKeys = new Set<string>();
  for (const url of foundAgendaUrls) {
    const key = comparableUrl(url);
    if (seenAgendaKeys.has(key) || officialKeys.has(key)) continue;
    seenAgendaKeys.add(key);
    agendaTargets.push(url);
    if (agendaTargets.length === 8) break;
  }

  const agendaMessages: Anthropic.Message[] = [];
  let failedFetches = 0;
  for (let index = 0; index < agendaTargets.length; index += 8) {
    const batch = agendaTargets.slice(index, index + 8);
    const settled = await Promise.allSettled(batch.map(async (url) => {
      const message = await requestPhase("agenda", () => client.messages.create({
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
      }, verificationRequestOptions));
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
      return discoverySchema.parse(JSON.parse(text)).candidates.slice(0, 10);
    }));
    settled.forEach((result, offset) => {
      if (result.status === "fulfilled") {
        discovered.push(...result.value);
      } else {
        failedFetches += 1;
        recordDrop(batch[offset], "discovery", dropReason(result.reason));
      }
    });
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
  const urlEntries: VerificationEntry[] = [];
  const nameEntries: VerificationEntry[] = [];
  for (const candidate of pool) {
    if (candidate.startDate > input.end || (candidate.endDate ?? candidate.startDate) < input.start) {
      recordDrop(candidate.title, "discovery", "Buiten het verzamelvenster.");
      continue;
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
  }

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
      requests: searches.length + agendaTargets.length,
      usage: usageTotals([...searches, ...agendaMessages], failedFetches),
      funnel: { namesDiscovered, urlsResolved: 0, pagesVerified: 0, demandAccepted: 0, drops },
    };
  }

  const verified: { entry: VerificationEntry; message: Anthropic.Message }[] = [];
  for (let index = 0; index < queue.length; index += 8) {
    const batch = queue.slice(index, index + 8);
    const settled = await Promise.allSettled(batch.map(async (entry) => {
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
      const message = await requestPhase("verification", () =>
        client.messages.create(
          {
            model,
            max_tokens: 2_000,
            ...(model.startsWith("claude-sonnet-5")
              ? { thinking: { type: "disabled" as const } }
              : {}),
            tools,
            output_config: { format: zodOutputFormat(outputSchema) },
            messages: [
              {
                role: "user",
                content: entry.officialUrl
                  ? `Open deze specifieke officiële evenementpagina. ${verificationInstructions(input)} Pagina:\n${entry.officialUrl}`
                  : `Zoek met één zoekopdracht de officiële pagina van dit evenement en open die pagina: ${entry.title}, ${entry.startDate}${entry.venue ? `, ${entry.venue}` : ""}, ${entry.city}. Een uitagenda, blog, ticketaggregator of zoekpagina is geen officiële pagina. ${verificationInstructions(input)}`,
              },
            ],
          },
          verificationRequestOptions,
        ),
      );
      await observeUsage(input.onUsage, usageEvent(message, "discovery_fetch", model));
      if ((message.usage.server_tool_use?.web_fetch_requests ?? 0) < 1) {
        throw new Error("Claude verification did not execute its required web fetch.");
      }
      return message;
    }));
    settled.forEach((result, offset) => {
      const entry = batch[offset];
      if (result.status === "fulfilled") {
        verified.push({ entry, message: result.value });
      } else {
        failedFetches += 1;
        firstFailure ??= result.reason;
        recordDrop(entry.title ?? entry.officialUrl ?? "", "verification", `Fetch mislukt: ${dropReason(result.reason)}`);
      }
    });
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
      evidenceText: event.evidenceText,
      primarySourceConfirmed: event.primarySourceConfirmed,
    } satisfies EventCandidate;
    candidate.providerEventId = claudeProviderEventId(candidate);
    return candidate;
  }));

  return {
    source: "claude",
    candidates,
    requests: searches.length + agendaTargets.length + queue.length,
    usage: usageTotals(
      [...searches, ...agendaMessages, ...verified.map(({ message }) => message)],
      failedFetches,
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
  const model = input.model ?? process.env.ANTHROPIC_TRIAGE_MODEL ?? "claude-haiku-4-5";
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


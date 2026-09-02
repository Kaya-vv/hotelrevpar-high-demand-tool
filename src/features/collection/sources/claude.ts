import Anthropic, { APIConnectionTimeoutError } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { createHash } from "node:crypto";
import { z } from "zod";

import type { DemandTriage, EvidenceReview } from "@/features/events/hotel-demand";
import { normalizeText } from "@/features/events/normalize";
import type { EventCandidate } from "@/features/events/types";
import { getAddressById, searchAddresses } from "@/features/portfolio/geocode";

import type { CollectionWindow, SourceResult } from "../types";

const ownerTypes = ["organizer", "venue", "club", "federation", "ticket_provider", "university", "municipality", "event_owner"] as const;
const searchRequestOptions = { timeout: 120_000, maxRetries: 0 } as const;
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
      ownerType: z.string(),
      evidenceText: z.string().nullable(),
      impactPoints: z.number().int().nullable(),
      titleConfirmed: z.boolean(),
      dateConfirmed: z.boolean(),
      locationConfirmed: z.boolean(),
    }),
  ),
});

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
  if (/[\s'"{}\[\]]/.test(value)) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.hostname !== "api.predicthq.com";
  } catch {
    return false;
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

async function requestPhase<T>(phase: "search" | "verification", request: () => Promise<T>) {
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

function discoveryUrls(message: Anthropic.Message) {
  const cited = message.content.flatMap((block) =>
    block.type === "text"
      ? block.citations?.flatMap((citation) =>
          citation.type === "web_search_result_location" ? [citation.url] : []
        ) ?? []
      : []
  );
  return [...new Set([...cited, ...sourceUrls(message)].filter(isPublicEvidenceUrl))]
    .slice(0, 2);
}

export async function collectClaude(
  input: CollectionWindow & {
    location: string;
    radiusKm: number;
    model?: string;
    client?: Anthropic;
    onUsage?: UsageObserver;
    geocode?: (query: string) => Promise<{ latitude: number; longitude: number } | null>;
    knownUrls?: string[];
  },
): Promise<SourceResult> {
  const model = input.model ?? process.env.ANTHROPIC_MODEL;
  if (!model) throw new Error("ANTHROPIC_MODEL is required for the Claude source.");
  const client = input.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const searches: Anthropic.Message[] = [];
  for (const window of searchWindows(input.start, input.end)) {
    for (const focus of searchGroups) {
      const search = await requestPhase("search", () => client.messages.create({
        model,
        max_tokens: 300,
        tools: [{
          type: "web_search_20260318",
          name: "web_search",
          allowed_callers: ["direct"],
          max_uses: 1,
          response_inclusion: "full",
        }],
        messages: [{
          role: "user",
          content: `Zoek binnen ${input.radiusKm} km van ${input.location} tussen ${window.start} en ${window.end} naar ${focus} die High- of Piek-hotelvraag kunnen veroorzaken. Kies maximaal twee sterke kandidaten. Geef alleen specifieke officiële evenementpagina's van de organisator, locatie, club, federatie, universiteit of gemeente. Gebruik agenda's en ticketlijsten alleen om die officiële pagina's te vinden. Geef geen voorspelde wedstrijdvensters of onbevestigde evenementen.`,
        }],
      }, searchRequestOptions));
      await observeUsage(input.onUsage, usageEvent(search, "discovery", model));
      searches.push(search);
    }
  }
  const urls = [...new Set([
    ...(input.knownUrls ?? []).slice(0, 8),
    ...searches.flatMap(discoveryUrls),
  ])].slice(0, 32);
  if (!urls.length) {
    return {
      source: "claude",
      candidates: [],
      requests: searches.length,
      usage: {
        inputTokens: searches.reduce((total, message) => total + message.usage.input_tokens, 0),
        outputTokens: searches.reduce((total, message) => total + message.usage.output_tokens, 0),
        webSearchRequests: searches.reduce(
          (total, message) => total + (message.usage.server_tool_use?.web_search_requests ?? 0),
          0,
        ),
        webFetchRequests: 0,
      },
    };
  }

  const batches = Array.from(
    { length: Math.ceil(urls.length / 2) },
    (_, index) => urls.slice(index * 2, index * 2 + 2),
  );
  const verified = await Promise.all(batches.map(async (batch) => {
    const message = await requestPhase("verification", () => client.messages.create({
      model,
      max_tokens: 1_500,
      ...(model.startsWith("claude-sonnet-5")
        ? { thinking: { type: "disabled" as const } }
        : {}),
      tools: [{
        type: "web_fetch_20250910",
        name: "web_fetch",
        max_uses: batch.length,
        max_content_tokens: 750,
        citations: { enabled: false },
      }],
      output_config: { format: zodOutputFormat(outputSchema) },
      messages: [{
        role: "user",
        content: `Open deze officiële pagina's en controleer per evenement titel, datum, locatie en status. Gebruik status active, cancelled of postponed. Neem alleen evenementen tussen ${input.start} en ${input.end} binnen ${input.radiusKm} km van ${input.location} op. Classificeer de extra overnachtingsvraag voor hotels: 35 Medium, 45 High of 60 Piek. Baseer dit op broninformatie over bezoekers van buiten de regio, meerdaagse duur, internationaal of nationaal bereik, capaciteit en een laat programma. Gebruik null als de pagina geen hotelspecifiek vraagsignaal ondersteunt. Neem actieve evenementen met null of Low impact niet op. Geef een specifieke locatie zodat die gegeocodeerd kan worden. Pagina's:\n${batch.join("\n")}`,
      }],
    }, verificationRequestOptions));
    await observeUsage(input.onUsage, usageEvent(message, "discovery_fetch", model));
    return message;
  }));
  const events = verified.flatMap((message) => {
    if (message.stop_reason === "max_tokens") {
      throw new Error("Claude verification reached its token limit.");
    }
    const text = message.content.find((block) => block.type === "text")?.text;
    if (!text) throw new Error("Claude verification returned no structured output.");
    const observed = sourceUrls(message);
    return outputSchema.parse(JSON.parse(text)).events.filter((event) =>
      observedUrl(event.sourceUrl, observed) &&
      (event.status !== "active" || [35, 45, 60].includes(event.impactPoints ?? 0))
    );
  });
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
      primarySourceConfirmed:
        ownerTypes.includes(event.ownerType as (typeof ownerTypes)[number]) &&
        event.titleConfirmed &&
        event.dateConfirmed &&
        event.locationConfirmed,
    } satisfies EventCandidate;
    candidate.providerEventId = claudeProviderEventId(candidate);
    return candidate;
  }));

  const messages = [...searches, ...verified];
  return {
    source: "claude",
    candidates,
    requests: messages.length,
    usage: {
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


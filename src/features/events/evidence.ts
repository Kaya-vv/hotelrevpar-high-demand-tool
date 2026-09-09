import { z } from "zod";
import type { EventCandidate } from "./types";

export const eventFactsSchema = z.object({
  dateText: z.string(),
  announcedAt: z.string().nullable().optional(),
  announcementText: z.string().nullable().optional(),
  announcementSourceUrl: z.url().nullable().optional(),
  aliases: z.array(z.string()).max(5).optional(),
  identityText: z.string().nullable().optional(),
  locationText: z.string(),
  venueAddress: z.string().nullable().optional(),
  locationSourceUrl: z.url().nullable().optional(),
  hostCity: z.string().nullable(),
  hostCityText: z.string().nullable().optional(),
  locationScope: z.enum(["venue", "citywide", "unknown"]),
  continuous: z.boolean(),
  majorCompetition: z.boolean(),
  demand: z.array(z.object({
    sourceUrl: z.url(), text: z.string(),
    kind: z.enum(["hotel_stay", "travelling_audience", "national_competition", "international_fixture", "destination_event", "trade_fair", "local_audience", "camping", "attendance"]).optional(),
    quantity: z.object({ value: z.number().positive(), unit: z.enum(["people", "hotel_rooms", "visits", "capacity"]), period: z.enum(["per_day", "per_night", "whole_event"]) }).nullable().optional(),
    scope: z.enum(["edition", "series", "historical"]),
    year: z.number().int().nullable(),
    comparable: z.boolean(),
    applicability: z.string().nullable().optional(),
  })),
});
export type EventEvidence = z.infer<typeof eventFactsSchema> & {
  history?: { checkedAt: string; startAt: string; endAt: string; status: string; dateText: string; dateSourceUrl: string }[];
  assessmentVersion?: number;
  dateSourceUrl: string;
  checkedAt: string;
  locationResolution?: { query: string; method: "venue" | "city_centroid"; latitude: number; longitude: number };
  locationAddressEvidence?: { sourceUrl: string; text: string; checkedAt: string };
};

export const evidenceInstructions = `Classify each demand quote using kind: hotel_stay ONLY for event-specific hotel room blocks, packages or participant accommodation services, never generic hotel footers or camping tents. travelling_audience requires origin/travel of visitors, delegates, exhibitors or teams, NOT artists or international branding. national_competition requires national participation/qualification; international_fixture requires a confirmed international away team fixture. destination_event requires an established destination festival with comparable visitor origin or substantial visitor scale, not duration alone. trade_fair requires substantial exhibitors travelling for a continuous trade programme. local_audience requires explicit local/regional audience. camping alone does not establish hotel demand. attendance describes audience. quantity must quote a count with its unit (people, visits, hotel_rooms, capacity) and period (per_day, per_night, whole_event); do not confuse seats, countries, years or cumulative visits with people. Return null when not explicit. A single-night concert qualifies through travelling fans or event hotel stays, never an artist name alone. Keep confirmed relevant events with unknown magnitude. Return facts separately from conclusions. announcedAt is the official announcement publication date in YYYY-MM-DD, only when announcementText quotes it from announcementSourceUrl; it is NEVER the event date or fetch date. Return null when unknown. aliases may contain official alternative series names only when identityText quotes their explicit relationship on the fetched page; sharing a venue or calendar is not an alias. facts.dateText and facts.locationText must be verbatim passages from the fetched sourceUrl (or locationSourceUrl for location) supporting the edition's dates and host location. Set venueAddress only to the physical event venue address supported by locationText, not an organiser office address. On the host venue's own event page, its contact address can establish the venue's physical address: include that address verbatim in locationText and venueAddress. Set hostCity only to the officially named city, never the search city or organiser's postal city. Include the host city in locationText, or use hostCityText for a separate verbatim passage from the same location source that identifies the event's host city when the venue or citywide description does not repeat it. Use locationScope citywide only for an explicitly citywide event. Set continuous only for one continuous edition, not separate performances or registration dates. Set majorCompetition only for an evidenced national/international championship or confirmed major fixture. Each facts.demand item must contain a verbatim supporting passage and its actually fetched official sourceUrl. Use scope edition for this edition, series for the official description of the ongoing series, historical for a prior edition and specify its year. Historical/series facts may support an assessment ONLY when the same series, host location and format are demonstrably comparable; comparable=false if uncertain. For series/historical scope, applicability must explain the evidence connecting the same series, host location and format; do not claim comparability without those facts. Never put prior attendance in attendance or infer audience origin from international performers. Do not treat online events, registration/application periods, deadlines or generic competition windows as physical events. Keep official dates with unknown location (empty locationText, hostCity null, locationScope unknown) or demand and return an empty demand array and null impactPoints/overnightAudience. Research comparable official audience, hotel/travel or venue-configuration information when date evidence alone is insufficient.`;

// HTML typography and model JSON may use different quote glyphs for the same passage.
const plain = (text: string) => text.normalize("NFKC").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();
/** Repair a stitched heading only when its remaining date range is one actual passage.
 * Never join fragments across editions or infer a year from another paragraph. */
function recoverDatePassage(quote: string, pages: { text: string }[], dates?: { startAt: string; endAt: string }) {
  if (!dates) return "";
  const [year, month, start] = dates.startAt.slice(0, 10).split("-").map(Number);
  const [endYear, endMonth, end] = dates.endAt.slice(0, 10).split("-").map(Number);
  if (year !== endYear || month !== endMonth || end < start) return "";
  const months = ["january|januari", "february|februari", "march|maart", "april", "may|mei", "june|juni", "july|juli", "august|augustus", "september", "october|oktober", "november", "december"];
  if (!months[month - 1]) return "";
  const range = `0?${start}\\s*[-–—]\\s*0?${end}\\s+(?:${months[month - 1]})`;
  const pattern = new RegExp(`\\b(?:${year}\\s+${range}|${range}\\s+${year})\\b`, "gi");
  for (const page of pages) for (const [passage] of page.text.matchAll(pattern)) {
    if (plain(quote).endsWith(plain(passage))) return passage;
  }
  return "";
}
function quotesPublicationDate(date: string, quote: string) {
  const [year, month, day] = date.split("-").map(Number);
  const months = ["january|januari|jan", "february|februari|feb", "march|maart|mar", "april|apr", "may|mei", "june|juni|jun", "july|juli|jul", "august|augustus|aug", "september|sep", "october|oktober|oct|okt", "november|nov", "december|dec"];
  return quote.includes(date) || new RegExp(`\\b0?${day}[-/.]0?${month}[-/.]${year}\\b|\\b0?${day}\\s+(?:${months[month - 1]})\\s+${year}\\b|\\b(?:${months[month - 1]})\\s+0?${day},?\\s+${year}\\b`, "i").test(quote);
}
export function verifyEventEvidence(
  facts: z.infer<typeof eventFactsSchema> | null | undefined,
  sourceUrl: string,
  pages: { url: string; text: string; checkedAt?: string }[],
  checkedAt: string,
  identity?: { venue: string | null; ownerType: string; startAt?: string; endAt?: string },
): EventEvidence | undefined {
  if (!facts || !eventFactsSchema.safeParse(facts).success) return undefined;
  const supported = (url: string, quote: string) => quote.trim().length >= 12
    && pages.some((page) => page.url === url && plain(page.text).includes(plain(quote)));
  const dateText = supported(sourceUrl, facts.dateText) ? facts.dateText : recoverDatePassage(facts.dateText,
    pages.filter((page) => page.url === sourceUrl), identity?.startAt && identity.endAt ? { startAt: identity.startAt, endAt: identity.endAt } : undefined);
  const locationSupported = supported(facts.locationSourceUrl ?? sourceUrl, facts.locationText);
  const scopePassages = [facts.locationText, facts.identityText && supported(sourceUrl, facts.identityText) ? facts.identityText : ""];
  const citywideSupported = scopePassages.some((text) => /city.?wide|across (?:the )?city|throughout (?:the )?city|door heel|in heel|verspreid|meerdere locaties|verschillende locaties|\d+ (?:locations|locaties)|multi.venue/i.test(text));
  const evidence: EventEvidence = { ...facts, dateText, assessmentVersion: 1, dateSourceUrl: sourceUrl, checkedAt,
    announcedAt: facts.announcedAt && /^\d{4}-\d{2}-\d{2}$/.test(facts.announcedAt) && Number.isFinite(Date.parse(facts.announcedAt)) && new Date(facts.announcedAt).toISOString().slice(0, 10) === facts.announcedAt && facts.announcedAt <= checkedAt.slice(0, 10) && facts.announcementText && quotesPublicationDate(facts.announcedAt, facts.announcementText) && supported(facts.announcementSourceUrl ?? sourceUrl, facts.announcementText) ? facts.announcedAt : null,
    hostCityText: facts.hostCityText && supported(facts.locationSourceUrl ?? sourceUrl, facts.hostCityText) ? facts.hostCityText : null,
    venueAddress: locationSupported && facts.venueAddress && plain(facts.locationText).includes(plain(facts.venueAddress)) ? facts.venueAddress : null,
    aliases: facts.identityText && supported(sourceUrl, facts.identityText) ? facts.aliases : [],
    ...(!locationSupported ? { locationText: "", hostCity: null, locationScope: "unknown" as const } : {}),
    ...(facts.locationScope === "citywide" && !citywideSupported ? { locationScope: "unknown" as const } : {}),
    demand: facts.demand.filter((fact) => supported(fact.sourceUrl, fact.text)

      && fact.comparable && (fact.scope === "edition" || (fact.applicability?.trim().length ?? 0) >= 12) && (fact.scope !== "historical" || fact.year !== null))
      .map((fact) => ({ ...fact, quantity: supportedQuantity(fact) })),
  };
  // Reuse an unambiguous address from the host venue's own fetched page, not an organiser office.
  if (!evidence.venueAddress && evidence.locationScope === "venue" && evidence.hostCity && identity?.ownerType === "venue" && identity.venue) {
    const brand = new URL(sourceUrl).hostname.replace(/^www\./, "").split(".")[0];
    const compact = (value: string) => plain(value).replace(/[^a-z0-9]/g, "");
    if (brand.length >= 3 && compact(identity.venue).includes(compact(brand))) {
      const city = evidence.hostCity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`[\\p{L}][\\p{L} .'-]{1,60}?\\s+\\d{1,5}[a-z]?\\s*,?\\s*[1-9]\\d{3}\\s?[a-z]{2}\\s+${city}\\b`, "giu");
      const addresses = pages.filter((page) => page.url === sourceUrl).flatMap((page) => [...page.text.matchAll(pattern)].filter(([text]) => !/postbus|p\.?o\.? box/i.test(text)).map(([text]) => ({ sourceUrl: page.url, text, checkedAt: page.checkedAt ?? checkedAt })));
      const unique = [...new Map(addresses.map((address) => [plain(address.text), address])).values()];
      if (unique.length === 1) { evidence.venueAddress = unique[0].text; evidence.locationAddressEvidence = unique[0]; }
    }
  }
  return evidence;
}

function supportedQuantity(fact: EventEvidence["demand"][number]) {
  const q = fact.quantity;
  if (!q) return null;
  const count = String(q.value).split("").join("[., ]?");
  const noun = q.unit === "people" ? "visitors?|bezoekers?|attendees|deelnemers?|delegates?|fans|atleten|participants?"
    : q.unit === "hotel_rooms" ? "hotel rooms?|hotelkamers?|rooms?|kamers?"
    : q.unit === "visits" ? "visits|bezoeken" : "seats|zitplaatsen|capacity|capaciteit";
  // Preserve units. 52 countries, 2027 edition and 2,000 seats are not attendee counts.
  const counted = new RegExp(`\\b${count}\\s+(?:${noun})\\b|\\b(?:${noun})\\s+(?:(?:was|were|is|was er|waren er|:|of)\\s+)?${count}\\b`, "i");
  if (!counted.test(fact.text)) return null;
  if (q.period === "per_night" && !/per night|each night|per nacht|iedere nacht/i.test(fact.text)) return null;
  if (q.period === "per_day" && !/per day|each day|daily|per dag|dagelijks/i.test(fact.text)) return null;
  return q;
}

export function hasDemandEvidence(candidate: Pick<EventCandidate, "evidence">) {
  return Boolean(candidate.evidence?.demand.some((fact) => fact.comparable && fact.text && fact.sourceUrl));
}

/**
 * People count documented by a comparable demand fact. A future edition can never carry
 * edition-scope attendance, so a comparable prior edition of the same series is the only
 * audience scale that can exist for it. This is a demand signal, never this edition's attendance.
 */
export function evidencedAudienceScale(evidence: EventEvidence | undefined) {
  if (!evidence) return null;
  // A bare four-digit number next to an audience noun is usually the edition year, not a crowd.
  const year = (value: number) => value >= 1900 && value <= 2099;
  const counted = /\b(\d{1,3}(?:[.,]\d{3})+|\d{4,6})\b(?=[^.!?\n]{0,30}?(?:visitor|bezoeker|audience|publiek|attend|deelnemer|delegate|exhibitor|exposant|liefhebber|enthusiast|music lover|fans|gast))/gi;
  let largest: number | null = null;
  for (const fact of evidence.demand) {
    if (!fact.comparable) continue;
    for (const [, digits] of fact.text.matchAll(counted)) {
      const people = Number(digits.replace(/[.,]/g, ""));
      if (!Number.isFinite(people) || (!/[.,]/.test(digits) && year(people))) continue;
      if (largest === null || people > largest) largest = people;
    }
  }
  return largest;
}

/** A copied legacy edition must not overwrite newer verified evidence from another lead. */
export function uniqueEvidenceEditions(events: EventCandidate[]) {
  const editions = new Map<string, EventCandidate>();
  const verifiedAt = (event: EventCandidate) => event.evidence?.dateText ? Date.parse(event.evidence.checkedAt) || 0 : 0;
  for (const event of events) {
    const previous = editions.get(event.providerEventId);
    if (!previous || verifiedAt(event) >= verifiedAt(previous)) editions.set(event.providerEventId, event);
  }
  return [...editions.values()];
}

// JSON storage is read at the source boundary; malformed/legacy evidence remains unknown.
export function readEventEvidence(value: unknown): EventEvidence | undefined {
  const parsed = eventFactsSchema.extend({
    history: z.array(z.object({ checkedAt: z.string(), startAt: z.string(), endAt: z.string(), status: z.string(), dateText: z.string(), dateSourceUrl: z.string() })).optional(),
    assessmentVersion: z.number().optional(), dateSourceUrl: z.url(), checkedAt: z.string(),
    locationResolution: z.object({ query: z.string(), method: z.enum(["venue", "city_centroid"]), latitude: z.number(), longitude: z.number() }).optional(),
    locationAddressEvidence: z.object({ sourceUrl: z.url(), text: z.string(), checkedAt: z.string() }).optional(),
  }).safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Amsterdam local midnight, not UTC midnight masquerading as an all-day event. */
export function localDateBoundary(date: string, end = false) {
  const referenceHour = end ? 21 : 0;
  const reference = new Date(`${date}T${end ? "21" : "00"}:00:00Z`);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", hour: "2-digit", hourCycle: "h23" }).format(reference));
  return new Date(Date.parse(`${date}T${end ? "23:59:59" : "00:00:00"}Z`) - (hour - referenceHour) * 3_600_000).toISOString();
}

/** Extract fetched document text without JSON escaping its whitespace. */
export function fetchedDocumentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(fetchedDocumentText).join("\n");
  if (!value || typeof value !== "object") return "";
  const content = value as Record<string, unknown>;
  return [content.text, content.content, content.source, content.data].map(fetchedDocumentText).filter(Boolean).join("\n");
}

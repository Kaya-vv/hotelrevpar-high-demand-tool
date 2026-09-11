import type { EventCandidate, NormalizedCandidate } from "./types";

export function validEventRange(event: Pick<EventCandidate, "startAt" | "endAt">) {
  const start = Date.parse(event.startAt), end = Date.parse(event.endAt);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start;
}

/**
 * A night event is routinely published with its end time on the start date: "23:00 - 04:30"
 * becomes 17:00 -> 04:30 on the same day. Rolling the end forward one day recovers a real
 * event; the database rejects the row otherwise, which aborted the whole collection run.
 * Returns null when the dates cannot be trusted at all, so the caller drops the candidate
 * instead of letting one bad row kill every other source's work.
 */
export function repairEventRange<T extends Pick<EventCandidate, "startAt" | "endAt">>(event: T): T | null {
  const start = Date.parse(event.startAt);
  if (!Number.isFinite(start)) return null;
  const end = Date.parse(event.endAt);
  if (!Number.isFinite(end)) return null;
  if (end >= start) return event;
  const rolled = end + 86_400_000;
  if (rolled < start) return null;
  return { ...event, endAt: new Date(rolled).toISOString() };
}

export function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const localDateTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Amsterdam",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function localParts(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { date: value.slice(0, 10), hour: 0, minute: 0 };
  }
  const parts = Object.fromEntries(
    localDateTime
      .formatToParts(parsed)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

// Older all-day records used a UTC end-of-day placeholder; retain their intended date.
export function eventLocalDate(value: string) {
  return /T23:59:59(?:\.000)?(?:Z|\+00:00)$/.test(value) ? value.slice(0, 10) : localParts(value).date;
}

// A place qualifier in a title carries no identity: every comparison that uses these tokens has
// already matched the event's date and place. Left in, they invent distinctions - "DigiMarCon
// Amsterdam 2026", "DigiMarCon Europe 2026" and "DigiMarCon Netherlands 2026" became three rows
// for one conference, one day, one venue, each published at High. Only continents, countries and
// Dutch cities belong here; "world" and "international" describe an audience, not a place, and
// they separate real events like the World Drug and World Patient Safety congresses.
const placeQualifiers = new Set([
  "europe", "europa", "european", "europees", "netherlands", "nederland", "dutch", "holland",
  "benelux", "amsterdam", "rotterdam", "utrecht", "eindhoven", "haag", "hague", "groningen",
  "maastricht", "tilburg", "almere", "breda", "nijmegen", "haarlem", "arnhem", "zaandam",
  "naarden", "leiden", "delft", "apeldoorn", "amersfoort", "zwolle",
]);

/** Title tokens that identify an event: no year, no place. Empty when a title is only those. */
export function meaningfulTokens(value: string) {
  const tokens = value
    .split(" ")
    .filter((token) => token && !/^20\d{2}$/.test(token) && !placeQualifiers.has(token));
  return tokens.length ? tokens : value.split(" ").filter(Boolean);
}

// Venue is free text and the model rephrases it every run - "Diverse locaties, Eindhoven centrum"
// one day, "Strijp-S en 100+ locaties in Eindhoven" the next - which gave one festival a fresh
// identity each time. A coarse coordinate bucket keeps different cities apart without depending
// on how the venue happens to be worded.
function placeKey(candidate: EventCandidate) {
  if (candidate.latitude !== null && candidate.longitude !== null) {
    return `${candidate.latitude.toFixed(1)},${candidate.longitude.toFixed(1)}`;
  }
  return normalizeText(candidate.venue ?? candidate.regionScope ?? "unknown");
}

/**
 * Categories whose editions are individual performances rather than one continuous run. A page
 * listing a series ("17, 19, 22 January") is routinely extracted as one event spanning first to
 * last date, so duration cannot be trusted to mean a stay for these.
 */
export function perPerformanceCategory(category: string) {
  return /concert|musical|theat|performance/i.test(category);
}

export function performanceTime(candidate: Pick<EventCandidate, "category" | "startAt">) {
  if (!perPerformanceCategory(candidate.category)) return "";
  const start = localParts(candidate.startAt);
  return start.hour === 0 && start.minute === 0 || /T00:00:00(?:\.000)?Z$/.test(candidate.startAt) ? "" : `${start.hour}:${start.minute}`;
}

export function normalizeCandidate(candidate: EventCandidate): NormalizedCandidate {
  const localStartDate = localParts(candidate.startAt).date;
  const normalizedTitle = normalizeText(candidate.title);
  // "Dutch Design Week" and "Dutch Design Week 2026" are one event on one date. similarity()
  // already discards year tokens; identity has to agree or the two never collapse.
  const identityTitle =
    normalizedTitle.split(" ").filter((token) => token && !/^20\d{2}$/.test(token)).join(" ")
    || normalizedTitle;

  return {
    ...candidate,
    localStartDate,
    localEndDate: candidate.endAt ? localParts(candidate.endAt).date : localStartDate,
    normalizedTitle,
    normalizedIdentity: [identityTitle, localStartDate, placeKey(candidate), ...(performanceTime(candidate) ? [performanceTime(candidate)] : [])].join("|"),
  };
}


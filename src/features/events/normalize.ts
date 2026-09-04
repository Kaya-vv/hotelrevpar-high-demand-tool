import type { EventCandidate, NormalizedCandidate } from "./types";

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
    normalizedIdentity: [identityTitle, localStartDate, placeKey(candidate)].join("|"),
  };
}


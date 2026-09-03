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


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

export function normalizeCandidate(candidate: EventCandidate): NormalizedCandidate {
  const localStartDate = localParts(candidate.startAt).date;
  const place = candidate.venue ?? candidate.regionScope ?? "unknown";
  const normalizedTitle = normalizeText(candidate.title);

  return {
    ...candidate,
    localStartDate,
    localEndDate: candidate.endAt ? localParts(candidate.endAt).date : localStartDate,
    normalizedTitle,
    normalizedIdentity: [normalizedTitle, localStartDate, normalizeText(place)].join("|"),
  };
}


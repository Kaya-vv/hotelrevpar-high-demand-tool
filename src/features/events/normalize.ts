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

export function normalizeCandidate(candidate: EventCandidate): NormalizedCandidate {
  const localStartDate = candidate.startAt.slice(0, 10);
  const place = candidate.venue ?? candidate.regionScope ?? "unknown";
  const normalizedTitle = normalizeText(candidate.title);

  return {
    ...candidate,
    localStartDate,
    normalizedTitle,
    normalizedIdentity: [normalizedTitle, localStartDate, normalizeText(place)].join("|"),
  };
}


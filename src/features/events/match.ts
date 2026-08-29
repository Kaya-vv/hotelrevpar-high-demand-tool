import type { NormalizedCandidate } from "./types";
import { distanceKm } from "./distance";

type ExistingEvent = NormalizedCandidate & { id: string };
export type Match =
  | { kind: "exact" | "uncertain"; eventId: string }
  | { kind: "new"; eventId: null };

function similarity(left: string, right: string) {
  const meaningful = (value: string) =>
    value.split(" ").filter((token) => token && !/^20\d{2}$/.test(token));
  const leftTokens = new Set(meaningful(left));
  const rightTokens = new Set(meaningful(right));
  const union = new Set([...leftTokens, ...rightTokens]);
  if (!union.size) return 0;
  let shared = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) shared += 1;
  });
  const jaccard = shared / union.size;
  const smallest = Math.min(leftTokens.size, rightTokens.size);
  const containment = smallest >= 3 ? shared / smallest : 0;
  return Math.max(jaccard, containment);
}

function samePlace(left: NormalizedCandidate, right: NormalizedCandidate) {
  if (
    left.latitude !== null &&
    left.longitude !== null &&
    right.latitude !== null &&
    right.longitude !== null
  ) {
    return (
      distanceKm(
        left.latitude,
        left.longitude,
        right.latitude,
        right.longitude
      ) <= 5
    );
  }
  const leftPlace = left.venue ?? left.regionScope;
  const rightPlace = right.venue ?? right.regionScope;
  return Boolean(leftPlace && rightPlace && leftPlace === rightPlace);
}

function placesConflict(left: NormalizedCandidate, right: NormalizedCandidate) {
  if (
    left.latitude === null ||
    left.longitude === null ||
    right.latitude === null ||
    right.longitude === null
  )
    return false;
  return (
    distanceKm(left.latitude, left.longitude, right.latitude, right.longitude) >
    10
  );
}

export function classifyMatch(
  candidate: NormalizedCandidate,
  existing: ExistingEvent[]
): Match {
  const providerMatch = existing.find(
    (event) =>
      event.provider === candidate.provider &&
      event.providerEventId === candidate.providerEventId
  );
  if (providerMatch) return { kind: "exact", eventId: providerMatch.id };

  const identityMatch = existing.find(
    (event) => event.normalizedIdentity === candidate.normalizedIdentity
  );
  if (identityMatch) return { kind: "exact", eventId: identityMatch.id };

  const strong = existing.find(
    (event) =>
      event.localStartDate === candidate.localStartDate &&
      ((!placesConflict(event, candidate) &&
        similarity(event.normalizedTitle, candidate.normalizedTitle) >= 0.92) ||
        (samePlace(event, candidate) &&
          similarity(event.normalizedTitle, candidate.normalizedTitle) >= 0.8))
  );
  if (strong) return { kind: "exact", eventId: strong.id };

  const uncertain = existing.find(
    (event) =>
      event.localStartDate === candidate.localStartDate &&
      samePlace(event, candidate) &&
      similarity(event.normalizedTitle, candidate.normalizedTitle) >= 0.6
  );
  return uncertain
    ? { kind: "uncertain", eventId: uncertain.id }
    : { kind: "new", eventId: null };
}

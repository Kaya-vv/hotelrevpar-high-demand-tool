import type { NormalizedCandidate } from "./types";
import { distanceKm } from "./distance";

type ExistingEvent = NormalizedCandidate & { id: string };
export type Match =
  | { kind: "exact"; eventId: string; extend?: boolean }
  | { kind: "uncertain"; eventId: string }
  | { kind: "new"; eventId: null };

function similarity(left: string, right: string) {
  const meaningful = (value: string) =>
    value.split(" ").filter((token) => token && !/^20\d{2}$/.test(token));
  const leftTokens = meaningful(left);
  const rightTokens = meaningful(right);
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const union = new Set([...leftSet, ...rightSet]);
  if (!union.size) return 0;
  let shared = 0;
  leftSet.forEach((token) => {
    if (rightSet.has(token)) shared += 1;
  });
  const jaccard = shared / union.size;
  const smallest = Math.min(leftSet.size, rightSet.size);
  const [shorter, longer] = leftTokens.length <= rightTokens.length
    ? [leftTokens, rightTokens]
    : [rightTokens, leftTokens];
  const prefix = shorter.length > 0 && shorter.every((token, index) => longer[index] === token);
  const containment = smallest >= 3 || prefix ? shared / smallest : 0;
  return Math.max(jaccard, containment);
}

function nextDay(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
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

  // A venue agenda lists each day of a multi-day programme as its own entry. An identical title
  // at the same place on a touching or overlapping date range is one event, not two.
  const consecutive = existing.find(
    (event) =>
      event.normalizedTitle === candidate.normalizedTitle &&
      samePlace(event, candidate) &&
      event.localStartDate <= nextDay(candidate.localEndDate) &&
      candidate.localStartDate <= nextDay(event.localEndDate)
  );
  if (consecutive) return { kind: "exact", eventId: consecutive.id, extend: true };

  const uncertain = existing.find(
    (event) =>
      event.localStartDate === candidate.localStartDate &&
      samePlace(event, candidate) &&
      similarity(event.normalizedTitle, candidate.normalizedTitle) >= 0.6
  );
  if (!uncertain) return { kind: "new", eventId: null };
  if (candidate.primarySourceConfirmed && !uncertain.primarySourceConfirmed) {
    return { kind: "exact", eventId: uncertain.id };
  }
  return { kind: "uncertain", eventId: uncertain.id };
}

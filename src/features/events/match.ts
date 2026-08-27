import type { NormalizedCandidate } from "./types";

type ExistingEvent = NormalizedCandidate & { id: string };
export type Match = { kind: "exact" | "uncertain"; eventId: string } | { kind: "new"; eventId: null };

function similarity(left: string, right: string) {
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  const union = new Set([...leftTokens, ...rightTokens]);
  if (!union.size) return 0;
  let shared = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) shared += 1;
  });
  return shared / union.size;
}

export function classifyMatch(candidate: NormalizedCandidate, existing: ExistingEvent[]): Match {
  const providerMatch = existing.find(
    (event) => event.provider === candidate.provider && event.providerEventId === candidate.providerEventId,
  );
  if (providerMatch) return { kind: "exact", eventId: providerMatch.id };

  const identityMatch = existing.find((event) => event.normalizedIdentity === candidate.normalizedIdentity);
  if (identityMatch) return { kind: "exact", eventId: identityMatch.id };

  const uncertain = existing.find(
    (event) =>
      event.localStartDate === candidate.localStartDate &&
      similarity(event.normalizedTitle, candidate.normalizedTitle) >= 0.8,
  );
  return uncertain ? { kind: "uncertain", eventId: uncertain.id } : { kind: "new", eventId: null };
}


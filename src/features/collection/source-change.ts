import { normalizeText } from "@/features/events/normalize";
import type { EventCandidate } from "@/features/events/types";

type ExistingSource = { extractedStartAt: string; extractedLocation: string | null };

/** The same source now reports another start time or place than it did last time. */
export function sourceChanged(existing: ExistingSource, candidate: EventCandidate) {
  return new Date(existing.extractedStartAt).getTime() !== new Date(candidate.startAt).getTime()
    || normalizeText(existing.extractedLocation ?? "") !== normalizeText(candidate.venue ?? candidate.regionScope ?? "");
}

export function shouldRefreshCanonical(candidate: EventCandidate) {
  return (
    candidate.provider === "claude" &&
    candidate.sourceState === "active" &&
    candidate.certainty === "confirmed" &&
    candidate.primarySourceConfirmed
  );
}

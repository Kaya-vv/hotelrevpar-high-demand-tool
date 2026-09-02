import { normalizeText } from "@/features/events/normalize";
import type { EventCandidate } from "@/features/events/types";

type ExistingSource = { extractedStartAt: string; extractedLocation: string | null };

export function sourceChange(existing: ExistingSource, candidate: EventCandidate) {
  if (new Date(existing.extractedStartAt).getTime() !== new Date(candidate.startAt).getTime()) {
    return { conflict: "changed_date" as const, preserveCanonical: true as const };
  }
  const location = candidate.venue ?? candidate.regionScope;
  if (normalizeText(existing.extractedLocation ?? "") !== normalizeText(location ?? "")) {
    return { conflict: "changed_venue" as const, preserveCanonical: true as const };
  }
  return { conflict: null, preserveCanonical: false as const };
}

export function shouldRefreshCanonical(candidate: EventCandidate) {
  return (
    candidate.provider === "claude" &&
    candidate.sourceState === "active" &&
    candidate.certainty === "confirmed" &&
    candidate.primarySourceConfirmed
  );
}


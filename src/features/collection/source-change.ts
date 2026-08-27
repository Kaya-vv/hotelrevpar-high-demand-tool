import { normalizeText } from "@/features/events/normalize";
import type { EventCandidate } from "@/features/events/types";

type ExistingSource = { extractedStartAt: string; extractedLocation: string | null };

export function sourceChange(existing: ExistingSource, candidate: EventCandidate) {
  if (existing.extractedStartAt !== candidate.startAt) {
    return { conflict: "changed_date" as const, preserveCanonical: true as const };
  }
  const location = candidate.venue ?? candidate.regionScope;
  if (normalizeText(existing.extractedLocation ?? "") !== normalizeText(location ?? "")) {
    return { conflict: "changed_venue" as const, preserveCanonical: true as const };
  }
  return { conflict: null, preserveCanonical: false as const };
}


import type {
  EventCandidate,
  ValidationOutcome,
  ValidationReason,
} from "./types";

type Window = { start: string; end: string };
type Conflict = Extract<
  ValidationReason,
  "duplicate_uncertain" | "date_conflict" | "changed_date" | "changed_venue"
> | null;

export function validateCandidate(
  candidate: EventCandidate,
  window: Window,
  conflict: Conflict
): ValidationOutcome {
  const certainty =
    candidate.sourceState === "predicted" ? "provisional" : candidate.certainty;
  const result = (
    state: ValidationOutcome["state"],
    reason: ValidationReason | null
  ): ValidationOutcome => ({
    state,
    reason,
    certainty,
  });

  if (!candidate.sourceUrl) return result("excluded", "missing_source");
  if (
    !candidate.providerEventId ||
    !candidate.title ||
    !candidate.category ||
    !candidate.startAt ||
    !candidate.endAt ||
    (!candidate.venue &&
      !candidate.regionScope &&
      (candidate.latitude === null || candidate.longitude === null))
  ) {
    return result("excluded", "missing_fields");
  }
  if (candidate.sourceState === "cancelled")
    return result("excluded", "cancelled");
  if (candidate.sourceState === "postponed")
    return result("excluded", "postponed");
  if (candidate.sourceState === "removed") return result("excluded", "removed");
  if (
    candidate.startAt.slice(0, 10) > window.end ||
    candidate.endAt.slice(0, 10) < window.start
  ) {
    return result("excluded", "out_of_window");
  }
  if (conflict) return result("needs_review", conflict);
  if (
    (candidate.provider === "claude" || candidate.provider === "predicthq") &&
    candidate.certainty === "confirmed" &&
    !candidate.primarySourceConfirmed
  ) {
    return result("excluded", "missing_primary_evidence");
  }
  return result("active", null);
}

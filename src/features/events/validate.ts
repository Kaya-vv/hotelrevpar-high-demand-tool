import { eventLocalDate } from "@/features/events/normalize";
import type {
  EventCandidate,
  ValidationOutcome,
  ValidationReason,
} from "./types";

type Window = { start: string; end: string };

const yearAheadProviders: Partial<Record<EventCandidate["provider"], true>> = {
  claude: true, openholidays: true, rijksoverheid: true, ticketmaster: true, footballdata: true,
};

/** Sources a paid run asks about the year ahead are judged against it; the rest stop at the
 * near-term window. A source missing here has every later event it confirms excluded - which is
 * how Ticketmaster hid U2 after the AI search had already published it. */
export function validationWindow(provider: EventCandidate["provider"], nearTerm: Window, yearAheadEnd: string): Window {
  return yearAheadProviders[provider] ? { start: nearTerm.start, end: yearAheadEnd } : nearTerm;
}

export function validateCandidate(
  candidate: EventCandidate,
  window: Window,
  /** Matches an existing event too closely to publish beside it, too loosely to merge into it. */
  uncertainDuplicate = false,
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
    eventLocalDate(candidate.startAt) > window.end ||
    eventLocalDate(candidate.endAt) < window.start
  ) {
    return result("excluded", "out_of_window");
  }
  if (uncertainDuplicate) return result("excluded", "duplicate_uncertain");
  if (
    (candidate.provider === "claude" || candidate.provider === "predicthq") &&
    candidate.certainty === "confirmed" &&
    !candidate.primarySourceConfirmed
  ) {
    return result("excluded", "missing_primary_evidence");
  }
  return result("active", null);
}

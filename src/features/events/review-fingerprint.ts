import { normalizeText } from "./normalize";
import type { EventCandidate, ValidationReason } from "./types";

export function reviewFingerprint(
  candidate: EventCandidate,
  reason: ValidationReason,
  targetEventId: string | null
) {
  return [
    reason,
    candidate.provider,
    candidate.providerEventId,
    candidate.sourceState,
    candidate.startAt,
    candidate.endAt,
    normalizeText(candidate.venue ?? candidate.regionScope ?? ""),
    targetEventId ?? "",
  ].join("|");
}

export const providerStatusReasons = new Set<ValidationReason>(["cancelled", "postponed", "removed"]);

// Every exclusion the pipeline decides records why, so later evidence can reverse it. A null
// reason means a human excluded the event, and that decision is sticky.
export function automatedExclusionReason(
  state: string,
  validationReason: ValidationReason | null,
  existingManualExclusion: boolean,
) {
  if (existingManualExclusion || state !== "excluded" || !validationReason) return null;
  return providerStatusReasons.has(validationReason) ? `provider_${validationReason}` : validationReason;
}

export function resolvedReviewState(input: {
  validationState: "active" | "needs_review" | "excluded";
  existingState?: "active" | "needs_review" | "excluded" | "ended";
  existingFingerprint?: string | null;
  fingerprint: string | null;
  conflict: boolean;
  automatedExclusion?: boolean;
}) {
  if (input.fingerprint && input.existingFingerprint === input.fingerprint) {
    return input.existingState === "excluded" ? "excluded" : "active";
  }
  if (
    input.existingState === "excluded" &&
    !input.existingFingerprint &&
    !input.conflict &&
    !input.automatedExclusion
  )
    return "excluded";
  return input.validationState;
}

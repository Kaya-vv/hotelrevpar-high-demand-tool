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

import { normalizeText } from "./normalize";
import type { EventCandidate } from "./types";

export type DemandTriage = {
  providerEventId: string;
  decision: "exclude" | "verify" | "provisional";
  confidence: "high" | "medium" | "low";
  demandLevel: "low" | "medium" | "high" | "peak";
  evidenceText: string;
};

export type EvidenceReview = {
  providerEventId: string;
  decision: "verified" | "unverifiable";
  confidence: "high" | "medium" | "low";
  sourceUrl: string | null;
  evidenceText: string;
};

export function demandReviewFingerprint(candidate: EventCandidate) {
  return [
    normalizeText(candidate.title),
    candidate.category,
    candidate.startAt,
    candidate.endAt,
    normalizeText(candidate.venue ?? ""),
    candidate.latitude ?? "",
    candidate.longitude ?? "",
    candidate.localRank ?? "",
    candidate.attendance ?? "",
    candidate.venueCapacity ?? "",
    candidate.aiImpactPoints ?? "",
    candidate.sourceState,
    candidate.providerDeletedReason ?? "",
    candidate.providerDuplicateOfId ?? "",
  ].join("|");
}

export function applyDemandTriage(
  candidate: EventCandidate,
  review: DemandTriage
): EventCandidate {
  return {
    ...candidate,
    aiImpactPoints: { low: 20, medium: 35, high: 45, peak: 60 }[
      review.demandLevel
    ],
    evidenceText: review.evidenceText,
  };
}

export function prefilterHotelDemand(candidate: EventCandidate): {
  action: "persist" | "triage" | "provisional" | "exclude";
  reason: string;
} {
  if (candidate.provider !== "predicthq")
    return { action: "persist", reason: "trusted_source" };
  if (
    candidate.sourceState === "cancelled" ||
    candidate.sourceState === "postponed" ||
    candidate.sourceState === "removed"
  ) {
    return { action: "persist", reason: "exception" };
  }
  const attendance = candidate.attendance ?? 0;
  const rank = candidate.localRank ?? 0;
  const spansMultipleDays =
    candidate.startAt.slice(0, 10) !== candidate.endAt.slice(0, 10);

  if (candidate.sourceState === "predicted") {
    if (/\b(champions league|uefa champions)\b/i.test(candidate.title)) {
      return { action: "provisional", reason: "competition_forecast" };
    }
    const strongPredictedBusiness =
      spansMultipleDays &&
      ["conferences", "expos"].includes(candidate.category) &&
      (attendance >= 3_000 || rank >= 80);
    const strongPredictedPublicEvent =
      ["concerts", "festivals", "sports"].includes(candidate.category) &&
      (attendance >= 20_000 || rank >= 90);
    return strongPredictedBusiness || strongPredictedPublicEvent
      ? { action: "triage", reason: "strong_prediction" }
      : { action: "exclude", reason: "weak_prediction" };
  }

  if (candidate.category === "sports") {
    return attendance >= 10_000 || rank >= 95
      ? { action: "triage", reason: "plausible_demand" }
      : { action: "exclude", reason: "low_impact_sports" };
  }
  if (candidate.category === "community") {
    return attendance >= 10_000 || rank >= 95
      ? { action: "triage", reason: "plausible_demand" }
      : { action: "exclude", reason: "low_impact_community" };
  }
  const strongSignal = attendance >= 5_000 || rank >= 80;
  const multiDayBusiness =
    spansMultipleDays &&
    ["conferences", "expos"].includes(candidate.category) &&
    (attendance >= 1_000 || rank >= 65);
  const multiDayFestival =
    spansMultipleDays &&
    candidate.category === "festivals" &&
    (attendance >= 2_000 || rank >= 70);
  if (strongSignal || multiDayBusiness || multiDayFestival) {
    return { action: "triage", reason: "plausible_demand" };
  }
  return { action: "exclude", reason: "weak_demand_signal" };
}

export function applyEvidenceReview(
  candidate: EventCandidate,
  review: EvidenceReview
): EventCandidate {
  return {
    ...candidate,
    publicSourceUrl: review.sourceUrl,
    evidenceText: review.evidenceText,
    certainty: review.decision === "verified" ? "confirmed" : "provisional",
    primarySourceConfirmed:
      review.decision === "verified" && Boolean(review.sourceUrl),
  };
}

export function asProvisional(
  candidate: EventCandidate,
  evidenceText?: string
): EventCandidate {
  return {
    ...candidate,
    publicSourceUrl: null,
    certainty: "provisional",
    evidenceText: evidenceText ?? candidate.evidenceText,
    primarySourceConfirmed: false,
  };
}

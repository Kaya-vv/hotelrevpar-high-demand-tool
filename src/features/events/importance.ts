import { hasHotelDemand, readDemandAssessment } from "./demand-assessment";
export type DemandLevel = "Low" | "Medium" | "High" | "Peak";

export const demandLabels: Record<DemandLevel, string> = {
  Low: "Laag",
  Medium: "Verhoogd",
  High: "Hoog",
  Peak: "Piek",
};

export const demandLevels = Object.keys(demandLabels) as DemandLevel[];

export const publishableDemandLevels = ["High", "Peak"] as const;

export function isPublishableDemand(
  importance: DemandLevel,
  impactBasis: string,
) {
  return (
    publishableDemandLevels.includes(
      importance as (typeof publishableDemandLevels)[number],
    ) && impactBasis === "demand_rule"
  );
}

/** Supported planning events are visible at every horizon, without inventing a grade. */
export function isAnnouncedLongRange(input: {
  startDate: string; endDate: string; nearTermHorizon: string;
  demandRadiusKm: number | null; hasConfirmedDateAndLocation: boolean;
  scores: { importance: DemandLevel; impactBasis: string; distanceKm: number | null; assessment?: unknown }[];
}) {
  return input.hasConfirmedDateAndLocation && input.scores.some((score) => hasHotelDemand(readDemandAssessment(score.assessment))
    && !isPublishableDemand(score.importance, score.impactBasis)
    && score.distanceKm !== null && input.demandRadiusKm !== null && score.distanceKm <= input.demandRadiusKm);
}

export function publishableReviewEventIds(
  decisions: { event_id: string; state: string }[],
  scores: {
    event_id: string;
    suggested_importance: string;
    importance_override: string | null;
    impact_basis: string;
    demand_assessment?: unknown;
  }[],
) {
  const reviewIds = new Set(
    decisions
      .filter((decision) => decision.state === "needs_review")
      .map((decision) => decision.event_id),
  );
  return new Set(
    scores
      .filter(
        (score) =>
          reviewIds.has(score.event_id) &&
          (hasHotelDemand(readDemandAssessment(score.demand_assessment)) || isPublishableDemand(
            (score.importance_override ?? score.suggested_importance) as DemandLevel,
            score.impact_basis,
          )),
      )
      .map((score) => score.event_id),
  );
}

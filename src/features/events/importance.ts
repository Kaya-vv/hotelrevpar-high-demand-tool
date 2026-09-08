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
    ) && impactBasis !== "default"
  );
}

/**
 * Beyond the near-term horizon a demand grade cannot be earned yet: a future edition has no
 * attendance of its own and organisers rarely publish audience information a year ahead. An
 * edition whose demand WAS assessed from evidence is still worth announcing, without a level.
 * Unassessed editions (impactBasis "default") stay hidden — that is league fixtures and open days.
 */
export function isAnnouncedLongRange(input: {
  startDate: string;
  nearTermHorizon: string;
  demandRadiusKm: number | null;
  scores: { importance: DemandLevel; impactBasis: string; distanceKm: number | null }[];
}) {
  if (input.startDate <= input.nearTermHorizon) return false;
  if (input.scores.some((score) => isPublishableDemand(score.importance, score.impactBasis))) return false;
  return input.scores.some(
    (score) =>
      score.impactBasis === "ai_assessment" &&
      score.distanceKm !== null &&
      input.demandRadiusKm !== null &&
      score.distanceKm <= input.demandRadiusKm,
  );
}

export function publishableReviewEventIds(
  decisions: { event_id: string; state: string }[],
  scores: {
    event_id: string;
    suggested_importance: string;
    importance_override: string | null;
    impact_basis: string;
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
          isPublishableDemand(
            (score.importance_override ?? score.suggested_importance) as DemandLevel,
            score.impact_basis,
          ),
      )
      .map((score) => score.event_id),
  );
}

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
 * attendance of its own and organisers rarely publish audience information a year ahead. Two
 * kinds of edition are still worth announcing, without a level.
 *
 * The first is an edition whose demand WAS assessed from evidence. The second is a multi-day
 * edition whose official organiser page already confirms both its date and its location: a
 * three-day-or-longer run that an organiser has committed to a year ahead is a destination event
 * by construction, and requiring attendance evidence for it is structurally unachievable.
 *
 * Duration plus confirmed primary-source evidence is what keeps league fixtures and open days
 * hidden: fixtures come from feeds and never carry verbatim organiser evidence, and open days run
 * one or two days. Three is the threshold rather than two because at two the rule admits
 * `Bachelor Open Day 2026`, `Master Open Day 2027` and `Liquicity Winterfestival`.
 */
export function isAnnouncedLongRange(input: {
  startDate: string;
  endDate: string;
  nearTermHorizon: string;
  demandRadiusKm: number | null;
  hasConfirmedDateAndLocation: boolean;
  scores: { importance: DemandLevel; impactBasis: string; distanceKm: number | null }[];
}) {
  if (input.startDate <= input.nearTermHorizon) return false;
  if (input.scores.some((score) => isPublishableDemand(score.importance, score.impactBasis))) return false;
  const withinRadius = input.scores.some((score) =>
    score.distanceKm !== null && input.demandRadiusKm !== null && score.distanceKm <= input.demandRadiusKm);
  const assessed = input.scores.some((score) => score.impactBasis === "ai_assessment") && withinRadius;
  const durationDays = Math.round(
    (Date.parse(`${input.endDate.slice(0, 10)}T00:00:00Z`) - Date.parse(`${input.startDate.slice(0, 10)}T00:00:00Z`)) / 86_400_000) + 1;
  const destination = durationDays >= 3 && input.hasConfirmedDateAndLocation && withinRadius;
  return assessed || destination;
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

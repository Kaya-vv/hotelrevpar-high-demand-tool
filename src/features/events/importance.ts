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

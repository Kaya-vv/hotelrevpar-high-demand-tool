import { hasHotelDemand, readDemandAssessment } from "./demand-assessment";
import { perPerformanceCategory } from "./normalize";

export type DemandLevel = "Low" | "Medium" | "High" | "Peak";

export const demandLabels: Record<DemandLevel, string> = {
  Low: "Laag",
  Medium: "Verhoogd",
  High: "Hoog",
  Peak: "Piek",
};

export const demandLevels = Object.keys(demandLabels) as DemandLevel[];

export const publishableDemandLevels = ["High", "Peak"] as const;

/**
 * A grade earns publication whichever way it was reached: quoted demand evidence
 * (`demand_rule`) or an evidenced proxy such as an assessed audience, a measured attendance or a
 * marquee competition. `default` means nothing at all is known about the event's pull, so it
 * stays hidden. The scorer has already demoted anything a source argues against, which is why
 * the absence of a demand quote cannot hide an otherwise evidenced event here.
 */
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
 * The first is an edition carrying real hotel-demand evidence — a quoted room block, package or
 * travelling audience — whose scale is not yet gradeable. The second is a multi-day edition whose
 * official organiser page already confirms both its date and its location: a three-day-or-longer
 * continuous run committed to a year ahead is a destination event by construction, and requiring
 * attendance evidence for it is structurally unachievable. Per-performance categories are excluded
 * from that second rule: their "duration" is a series span, not a stay.
 *
 * A model-assigned proxy grade is deliberately NOT a third trigger. `impactPoints: 35` means the
 * model found no applicable demand signal, and the scorer then placed the event below High. Such
 * an event is not ungradeable, it is graded and judged insufficient; announcing it anyway
 * contradicted both and made visibility depend on the calendar date rather than the event. On
 * 2026-09-09 that admitted 45 unlevelled events across eight hotels — one-night tribute acts,
 * a children's museum evening, university open days — each demanding a manual export level.
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
  category: string;
  hasConfirmedDateAndLocation: boolean;
  scores: { importance: DemandLevel; impactBasis: string; distanceKm: number | null; assessment?: unknown }[];
}) {
  if (input.startDate <= input.nearTermHorizon) return false;
  if (input.scores.some((score) => isPublishableDemand(score.importance, score.impactBasis))) return false;
  const withinRadius = input.scores.some((score) =>
    score.distanceKm !== null && input.demandRadiusKm !== null && score.distanceKm <= input.demandRadiusKm);
  const assessed = withinRadius
    && input.scores.some((score) => hasHotelDemand(readDemandAssessment(score.assessment)));
  const durationDays = Math.round(
    (Date.parse(`${input.endDate.slice(0, 10)}T00:00:00Z`) - Date.parse(`${input.startDate.slice(0, 10)}T00:00:00Z`)) / 86_400_000) + 1;
  // Duration only means a stay for a continuous run. A concert series listed as "17, 19, 22
  // January" is extracted as one six-day event, which made four single Festival Oude Muziek
  // concerts look like destination events in Utrecht while the festival itself was graded High.
  const destination = durationDays >= 3 && !perPerformanceCategory(input.category)
    && input.hasConfirmedDateAndLocation && withinRadius;
  return assessed || destination;
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

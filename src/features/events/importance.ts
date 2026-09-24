import { hasHotelDemand, readDemandAssessment } from "./demand-assessment";
import { perPerformanceCategory } from "./normalize";

export type DemandLevel = "Low" | "Medium" | "High" | "Peak";

export const demandLabels: Record<DemandLevel, string> = {
  Low: "Laag",
  Medium: "Medium",
  High: "Hoog",
  Peak: "Piek",
};

export const demandLevels = Object.keys(demandLabels) as DemandLevel[];

export const publishableDemandLevels = ["High", "Peak"] as const;

/**
 * Levels the calendar shows when an operator asks to see Medium as well. Exports, notifications
 * and the database export guard never widen: Medium stays out of what a hotel pays for.
 */
const calendarMediumLevels = ["Medium", "High", "Peak"] as const;

/**
 * A grade earns publication whichever way it was reached: quoted demand evidence
 * (`demand_rule`) or an evidenced proxy such as an assessed audience, a measured attendance or a
 * marquee competition. `default` means nothing at all is known about the event's pull, so it
 * stays hidden. The scorer has already demoted anything a source argues against, which is why
 * the absence of a demand quote cannot hide an otherwise evidenced event here.
 *
 * `includeMedium` is the calendar's "ook Medium tonen" view only. Remote hotels can have no
 * High or Peak event at all, which left them staring at an empty calendar.
 */
export function isPublishableDemand(
  importance: DemandLevel,
  impactBasis: string,
  includeMedium = false,
) {
  const levels: readonly DemandLevel[] = includeMedium
    ? calendarMediumLevels
    : publishableDemandLevels;
  return levels.includes(importance) && impactBasis !== "default";
}

/**
 * The basis recorded for a hand-set level. `impact_basis` says what the automatic scorer had to
 * go on, and `default` means "nothing at all", which is why it blocks an automatic grade. Keeping
 * that block in front of a manual level made "Handmatige inschatting" silently do nothing exactly
 * on the events the scorer knew least about.
 */
export const manualDemandBasis = "manual_override";

/**
 * The one place that turns a stored score row into the level the calendar, the export and the
 * notifications all work from. A manual level replaces the suggested one and carries its own
 * basis, so every reader applies the same policy to an operator's decision.
 */
export function gradedDemand(score: {
  suggested_importance: string;
  importance_override: string | null;
  impact_basis: string;
}) {
  const manualLevel = (score.importance_override as DemandLevel | null) ?? null;
  return {
    importance: (manualLevel ?? score.suggested_importance) as DemandLevel,
    impactBasis: manualLevel ? manualDemandBasis : score.impact_basis,
    manualLevel,
    suggestedLevel: score.suggested_importance as DemandLevel,
  };
}

/**
 * Longest continuous run the destination rule accepts inside the near-term horizon. Near-term
 * listings include exhibitions and seasons that run for months (`Museum as Sundial`, 128 days);
 * those are not a stay. GLOW (9 days) and a five-day conference fit.
 */
export const nearTermDestinationMaxDays = 14;

/**
 * "Zelf beoordelen" (formerly "Hotelvraag"): an event worth showing without a High or Peak grade. Two kinds qualify.
 *
 * Beyond the near-term horizon a demand grade cannot be earned yet: a future edition has no
 * attendance of its own and organisers rarely publish audience information a year ahead. Inside
 * the horizon the grade can be earned but often is not: GLOW and the ASML Marathon were graded
 * Medium, so the normal calendar hid them unless an operator set a level by hand. Both periods
 * use the same two rules; inside the horizon the destination rule is capped at
 * `nearTermDestinationMaxDays`.
 *
 * An event whose grade already publishes it is shown with that grade instead, never twice.
 *
 * The first is an edition carrying real hotel-demand evidence — a quoted room block, package or
 * travelling audience — whose scale is not yet gradeable. The second is a multi-day edition whose
 * official organiser page already confirms both its date and its location: a three-day-or-longer
 * continuous run committed to a year ahead is a destination event by construction, and requiring
 * attendance evidence for it is structurally unachievable. Per-performance categories are excluded
 * from that second rule: their "duration" is a series span, not a stay. (Stadium concerts are
 * graded High by the scorer, see `stadiumConcertCapacity`; arena concerts need real evidence.)
 *
 * A model-assigned proxy grade is deliberately NOT a trigger. `impactPoints: 35` means the
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
 *
 * A hand-set level outranks all of it. An operator who grades an announcement Low or Medium has
 * judged the event not worth a room-rate decision, so announcing it anyway is the calendar
 * contradicting the person using it.
 */
export function isAnnouncedDemand(input: {
  startDate: string;
  endDate: string;
  nearTermHorizon: string;
  demandRadiusKm: number | null;
  category: string;
  hasConfirmedDateAndLocation: boolean;
  scores: { importance: DemandLevel; impactBasis: string; distanceKm: number | null; assessment?: unknown;
    manualLevel?: DemandLevel | null }[];
  includeMedium?: boolean;
}) {
  if (input.scores.some((score) => isPublishableDemand(score.importance, score.impactBasis, input.includeMedium))) return false;
  if (input.scores.some((score) => score.manualLevel)) return false;
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
    && input.hasConfirmedDateAndLocation && withinRadius
    && (input.startDate > input.nearTermHorizon || durationDays <= nearTermDestinationMaxDays);
  return assessed || destination;
}

export type HotelCalendarVisibilityScore = {
  importance: DemandLevel;
  impactBasis: string;
  distanceKm: number | null;
  assessment?: unknown;
  /** Hand-set level from `hotel_event_scores.importance_override`, null when automatic. */
  manualLevel?: DemandLevel | null;
};

/** One policy for the customer calendar, exports, and new-event notifications. */
export function hotelCalendarVisibility(input: {
  active: boolean;
  confirmed: boolean;
  supported: boolean;
  startDate: string;
  endDate: string;
  nearTermHorizon: string;
  demandRadiusKm: number | null;
  category: string;
  hasConfirmedDateAndLocation: boolean;
  scores: HotelCalendarVisibilityScore[];
  /** Calendar-only widening; see `isPublishableDemand`. */
  includeMedium?: boolean;
}) {
  if (!input.active || !input.confirmed || !input.supported) {
    return { visible: false, announced: false };
  }
  if (
    input.scores.some((score) =>
      isPublishableDemand(score.importance, score.impactBasis, input.includeMedium)
    )
  ) {
    return { visible: true, announced: false };
  }
  const announced = isAnnouncedDemand(input);
  return { visible: announced, announced };
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
      .filter((score) => {
        if (!reviewIds.has(score.event_id)) return false;
        if (hasHotelDemand(readDemandAssessment(score.demand_assessment))) return true;
        const graded = gradedDemand(score);
        return isPublishableDemand(graded.importance, graded.impactBasis);
      })
      .map((score) => score.event_id),
  );
}

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
 * A High or Peak grade earns automatic publication whichever way it was reached: quoted demand
 * evidence (`demand_rule`) or an evidenced proxy such as an assessed audience, measured
 * attendance, or marquee competition. `default` means nothing is known about the event's pull.
 */
export function isPublishableDemand(
  importance: DemandLevel,
  impactBasis: string,
) {
  return publishableDemandLevels.includes(importance as "High" | "Peak")
    && impactBasis !== "default";
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
 * Whether a multi-day span in this category can mean one continuous run, and so a stay. Not for
 * per-performance categories (`perPerformanceCategory`), nor for single shows the research labels
 * "Music": four Festival Oude Muziek touring concerts reached the Utrecht calendar that way in
 * September 2026. A festival stays a festival. "Dance" is deliberately absent: it covers both a
 * dance première run and Holland Masters Dans, a competition that draws couples from abroad.
 * Holidays are calendar context, never a destination.
 */
export function continuousRunCategory(category: string) {
  return !perPerformanceCategory(category)
    && !(/music|muziek|ballet|opera/i.test(category) && !/festival/i.test(category))
    && !/^(public_holiday|school_holiday)$/.test(category);
}

/**
 * Whether an event belongs to the shown Medium tier: likely hotel demand without a High or Peak
 * grade. These events appear in the normal calendar and email, but only enter an export when the
 * manager selects them.
 *
 * Beyond the near-term horizon a demand grade often cannot be earned yet: a future edition has
 * no attendance of its own and organisers rarely publish audience information a year ahead.
 * Inside the horizon the grade can be earned, but destination events may still lack a known
 * size. Both periods use the same rules; inside the horizon the destination rule is capped at
 * `nearTermDestinationMaxDays`.
 *
 * The first qualifying kind carries real hotel-demand evidence — a quoted room block, package,
 * or travelling audience — whose scale is not yet gradeable. The second is a multi-day edition
 * whose official organiser page confirms its date and location. Per-performance categories are
 * excluded because their span describes a series of separate shows rather than a stay.
 *
 * A model-assigned proxy grade alone is deliberately not a trigger. Duration plus confirmed
 * primary-source evidence keeps league fixtures and short open days out. A size-check result also
 * settles the unknown size: below High, it belongs in the hidden Laag tier.
 *
 * A hand-set level always wins. Medium means show in this tier; Low means hide by default; High
 * and Peak are handled by `isPublishableDemand`.
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
}) {
  if (input.scores.some((score) => isPublishableDemand(score.importance, score.impactBasis))) return false;
  const manual = input.scores.find((score) => score.manualLevel)?.manualLevel;
  if (manual) return manual === "Medium";
  if (input.scores.some((score) => score.impactBasis === "size_check")) return false;
  const withinRadius = input.scores.some((score) =>
    score.distanceKm !== null && input.demandRadiusKm !== null && score.distanceKm <= input.demandRadiusKm);
  const assessed = withinRadius
    && input.scores.some((score) => hasHotelDemand(readDemandAssessment(score.assessment)));
  const durationDays = Math.round(
    (Date.parse(`${input.endDate.slice(0, 10)}T00:00:00Z`) - Date.parse(`${input.startDate.slice(0, 10)}T00:00:00Z`)) / 86_400_000) + 1;
  // Duration only means a stay for a continuous run, see `continuousRunCategory`.
  const destination = durationDays >= 3 && continuousRunCategory(input.category)
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

/**
 * One policy for the customer calendar, export selection, and new-event notifications.
 * `shownLevel` is the label every UI reader must render. `announced` means shown as Medium and
 * exported only by manager choice.
 */
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
  /** Show the hidden-by-default Laag tier. */
  includeLow?: boolean;
}) {
  if (!input.active || !input.confirmed || !input.supported) {
    return { visible: false, announced: false, shownLevel: null };
  }
  const publishable = input.scores.find((score) =>
    isPublishableDemand(score.importance, score.impactBasis)
  );
  if (publishable) {
    return { visible: true, announced: false, shownLevel: publishable.importance };
  }
  const announced = isAnnouncedDemand(input);
  if (announced) {
    return { visible: true, announced: true, shownLevel: "Medium" as const };
  }
  const low = input.scores.some((score) =>
    (score.importance === "Low" || score.importance === "Medium")
    && score.impactBasis !== "default"
  );
  return {
    visible: Boolean(input.includeLow && low),
    announced: false,
    shownLevel: low ? "Low" as const : null,
  };
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

import { hasDemandEvidence, evidencedAudienceScale } from "./evidence";
import { assessHotelDemand, hasHotelDemand } from "./demand-assessment";
import { distanceKm } from "./distance";
import { localParts } from "./normalize";
import type { DemandScore, EventCandidate } from "./types";

function marqueeSport(category: string, title = "", regionScope = "") {
  if (category !== "sports") return false;
  const topClubCount = ["ajax", "feyenoord", "psv"].filter((club) =>
    title.toLowerCase().includes(club),
  ).length;
  return (
    /international|internationaal|european|europees/i.test(regionScope) ||
    /champions league|europa league|conference league|wereldkampioenschap|world cup|\bwk\b|europees kampioenschap|\bek\b|finale/i.test(
      title,
    ) || topClubCount >= 2
  );
}

function previousDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function repeatedPerformance(category: string) {
  return /musical|theat(?:er|re)|voorstelling/i.test(category);
}

export function importance(total: number): DemandScore["suggestedImportance"] {
  return total >= 85
    ? "Peak"
    : total >= 70
    ? "High"
    : total >= 40
    ? "Medium"
    : "Low";
}

export function impact(input: {
  localRank: number | null;
  attendance: number | null;
  venueCapacity: number | null;
  aiImpactPoints?: number | null;
  category: string;
  title?: string;
  evidence?: EventCandidate["evidence"];
}): { points: number; basis: DemandScore["impactBasis"] } {
  const capSport = (points: number) =>
    input.category === "sports" && !marqueeSport(input.category, input.title) && !(input.evidence?.majorCompetition && hasDemandEvidence(input))
      ? Math.min(points, 45)
      : points;
  if (input.aiImpactPoints !== undefined && input.aiImpactPoints !== null) {
    return {
      points: capSport(Math.max(0, Math.min(60, input.aiImpactPoints))),
      basis: "ai_assessment",
    };
  }
  if (input.localRank !== null) {
    return {
      points: capSport(
        Math.round(Math.max(0, Math.min(100, input.localRank)) * 0.6)
      ),
      basis: "local_rank",
    };
  }
  const people = input.attendance ?? input.venueCapacity;
  if (people !== null) {
    const points = capSport(
      people >= 15000
        ? 60
        : people >= 5000
        ? 45
        : people >= 2000
        ? 35
        : people >= 500
        ? 20
        : 10
    );
    const basis = input.attendance !== null ? "attendance" : "venue_capacity";
    return { points, basis };
  }
  if (marqueeSport(input.category, input.title))
    return { points: 60, basis: "competition_rule" };
  if (input.category === "school_holiday")
    return { points: 30, basis: "holiday_rule" };
  if (input.category === "public_holiday")
    return { points: 25, basis: "holiday_rule" };
  return { points: 20, basis: "default" };
}

type Hotel = {
  latitude: number;
  longitude: number;
  demandRadiusKm: number;
  holidayRegion: string | null;
};

type Overlap = { startAt: string; endAt: string; preOverlapTotal: number };

export function scoreHotelEvent({
  candidate,
  hotel,
  overlaps,
}: {
  candidate: EventCandidate;
  hotel: Hotel;
  overlaps: Overlap[];
}): DemandScore {
  // Quoted demand evidence is recorded alongside the proxy score. It can raise a grade and,
  // when it contradicts hotel demand, lower one. Its absence never lowers anything: a page
  // that omits visitor origins is a gap in the source, not proof that nobody travels.
  const assessment = assessHotelDemand(candidate, hotel);
  const impactScore = impact(candidate);
  let measuredDistance: number | null = null;
  let distancePoints = 0;

  if (candidate.category === "public_holiday") {
    distancePoints = 25;
  } else if (candidate.category === "school_holiday") {
    distancePoints = candidate.regionScope === hotel.holidayRegion ? 25 : 0;
  } else if (candidate.latitude !== null && candidate.longitude !== null) {
    measuredDistance = distanceKm(
      hotel.latitude,
      hotel.longitude,
      candidate.latitude,
      candidate.longitude
    );
    if (measuredDistance <= hotel.demandRadiusKm) {
      distancePoints = Math.max(
        0,
        Math.round(25 * (1 - measuredDistance / hotel.demandRadiusKm))
      );
    }
  }

  const start = localParts(candidate.startAt);
  const end = localParts(candidate.endAt);
  const hasDuration = new Date(candidate.endAt) > new Date(candidate.startAt);
  const allDayPlaceholder =
    (start.hour === 0 &&
      start.minute === 0 &&
      end.hour === 23 &&
      end.minute >= 59) ||
    (candidate.startAt.slice(11, 16) === "00:00" &&
      candidate.endAt.slice(11, 16) === "23:59");
  // A programme finishing before dawn is still the same evening, not a second day.
  const programmeEndDate = end.hour < 6 ? previousDate(end.date) : end.date;
  const multiDay = !repeatedPerformance(candidate.category) && (candidate.evidence?.continuous
    ? end.date > start.date
    : !allDayPlaceholder && programmeEndDate > start.date);
  let stayPressurePoints = multiDay ? 6 : 0;
  // A programme ending after midnight is a stronger overnight signal than one
  // ending at 20:00, so both earn the evening-finish bonus.
  if (hasDuration && !allDayPlaceholder && (end.hour >= 20 || end.hour < 6)) {
    stayPressurePoints += 4;
  }
  if (
    overlaps.some(
      (other) => {
        const otherStart = localParts(other.startAt).date;
        const otherEnd = localParts(other.endAt).date;
        return (
          other.preOverlapTotal >= 40 &&
          otherStart <= end.date &&
          otherEnd >= start.date
        );
      },
    )
  ) {
    stayPressurePoints += 5;
  }
  stayPressurePoints = Math.min(15, stayPressurePoints);
  const rawTotal = Math.min(
    100,
    impactScore.points + distancePoints + stayPressurePoints
  );
  const routineSport =
    candidate.category === "sports" &&
    !marqueeSport(candidate.category, candidate.title, candidate.regionScope ?? "")
    && !(candidate.evidence?.majorCompetition && hasDemandEvidence(candidate));
  const people = candidate.attendance ?? candidate.venueCapacity;
  // An explicit assessment from the source beats every proxy below it: a
  // two-day daytime market is multi-day without generating a single booking.
  // A comparable prior edition of the same series counts here: next year's edition cannot
  // document its own attendance yet, so requiring it would cap every announced series.
  const assessedDemandSignal =
    (candidate.attendance !== null && candidate.attendance >= 5_000) ||
    (candidate.venueCapacity !== null && candidate.venueCapacity >= 10_000) ||
    (evidencedAudienceScale(candidate.evidence) ?? 0) >= 5_000 ||
    marqueeSport(
      candidate.category,
      candidate.title,
      candidate.regionScope ?? "",
    );
  const knownReach =
    /internationaal|international|nationaal|national|europees|european|wereld|world/i.test(
      candidate.regionScope ?? "",
    );
  const overnightSignal =
    candidate.overnightAudience != null
      ? candidate.overnightAudience === "national" ||
        candidate.overnightAudience === "international"
      : candidate.aiImpactPoints != null
        ? assessedDemandSignal
        : programmeEndDate > start.date ||
          (people !== null && people >= 5_000) ||
          knownReach ||
          assessedDemandSignal;
  const contextOnly =
    candidate.category === "school_holiday" ||
    candidate.category === "public_holiday";
  // Only a source that argues against hotel demand demotes: a local-audience or camping
  // quote, a cancelled edition, an unconfirmed date or a location outside the radius.
  const contraryEvidence = assessment.relevance === "not_relevant";
  const outsideRadius = !contextOnly && (measuredDistance === null || measuredDistance > hotel.demandRadiusKm);
  const total = routineSport || contextOnly || outsideRadius || !overnightSignal || contraryEvidence
    ? Math.min(69, rawTotal)
    : rawTotal;
  // Quoted demand evidence grades on its own scale, independent of every proxy above it.
  const evidenced = contraryEvidence || !hasHotelDemand(assessment) ? 0
    : assessment.magnitude === "Peak" ? 90
    : assessment.magnitude === "High" ? 75
    : assessment.magnitude === "Medium" ? 50
    : 0;

  if (evidenced > total) {
    return {
      assessment,
      impactPoints: evidenced,
      impactBasis: "demand_rule",
      distanceKm: measuredDistance,
      distancePoints,
      stayPressurePoints,
      total: evidenced,
      suggestedImportance: importance(evidenced),
    };
  }
  return {
    assessment,
    impactPoints: impactScore.points,
    impactBasis: impactScore.basis,
    distanceKm: measuredDistance,
    distancePoints,
    stayPressurePoints,
    total,
    suggestedImportance: importance(total),
  };
}

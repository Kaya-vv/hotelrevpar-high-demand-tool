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
}): { points: number; basis: DemandScore["impactBasis"] } {
  const capSport = (points: number) =>
    input.category === "sports" && !marqueeSport(input.category, input.title)
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
  let stayPressurePoints = !allDayPlaceholder && start.date !== end.date ? 6 : 0;
  if (hasDuration && !allDayPlaceholder && end.hour >= 20) {
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
    !marqueeSport(candidate.category, candidate.title, candidate.regionScope ?? "");
  const total = routineSport ? Math.min(69, rawTotal) : rawTotal;

  return {
    impactPoints: impactScore.points,
    impactBasis: impactScore.basis,
    distanceKm: measuredDistance,
    distancePoints,
    stayPressurePoints,
    total,
    suggestedImportance: importance(total),
  };
}

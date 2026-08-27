import { distanceKm } from "./distance";
import type { DemandScore, EventCandidate } from "./types";

export function importance(total: number): DemandScore["suggestedImportance"] {
  return total >= 70 ? "High" : total >= 40 ? "Medium" : "Low";
}

export function impact(input: {
  localRank: number | null;
  attendance: number | null;
  venueCapacity: number | null;
  category: string;
}): { points: number; basis: DemandScore["impactBasis"] } {
  if (input.localRank !== null) {
    return { points: Math.round(Math.max(0, Math.min(100, input.localRank)) * 0.6), basis: "local_rank" };
  }
  const people = input.attendance ?? input.venueCapacity;
  if (people !== null) {
    const points = people >= 15000 ? 60 : people >= 5000 ? 45 : people >= 2000 ? 35 : people >= 500 ? 20 : 10;
    const basis = input.attendance !== null ? "attendance" : "venue_capacity";
    return { points, basis };
  }
  if (input.category === "school_holiday") return { points: 30, basis: "holiday_rule" };
  if (input.category === "public_holiday") return { points: 25, basis: "holiday_rule" };
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
    measuredDistance = distanceKm(hotel.latitude, hotel.longitude, candidate.latitude, candidate.longitude);
    if (measuredDistance <= hotel.demandRadiusKm) {
      distancePoints = Math.max(0, Math.round(25 * (1 - measuredDistance / hotel.demandRadiusKm)));
    }
  }

  let stayPressurePoints = candidate.startAt.slice(0, 10) !== candidate.endAt.slice(0, 10) ? 6 : 0;
  const localEndHour = Number(candidate.endAt.slice(11, 13));
  if (localEndHour >= 20) stayPressurePoints += 4;
  if (
    overlaps.some(
      (other) =>
        other.preOverlapTotal >= 40 &&
        other.startAt.slice(0, 10) <= candidate.endAt.slice(0, 10) &&
        other.endAt.slice(0, 10) >= candidate.startAt.slice(0, 10),
    )
  ) {
    stayPressurePoints += 5;
  }
  stayPressurePoints = Math.min(15, stayPressurePoints);
  const total = Math.min(100, impactScore.points + distancePoints + stayPressurePoints);

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

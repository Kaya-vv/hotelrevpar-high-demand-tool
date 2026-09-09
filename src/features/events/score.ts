import { distanceKm } from "./distance";
import { assessHotelDemand } from "./demand-assessment";
import type { DemandScore, EventCandidate } from "./types";

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
}: {
  candidate: EventCandidate;
  hotel: Hotel;
  overlaps: Overlap[];
}): DemandScore {
  const assessment = assessHotelDemand(candidate, hotel);
  const measuredDistance = candidate.latitude !== null && candidate.longitude !== null
    ? distanceKm(hotel.latitude, hotel.longitude, candidate.latitude, candidate.longitude) : null;
  const total = assessment.magnitude === "Peak" ? 90 : assessment.magnitude === "High" ? 75
    : assessment.magnitude === "Medium" ? 50 : 0;
  return { assessment, impactPoints: total, impactBasis: assessment.magnitude ? "demand_rule" : "default",
    distanceKm: measuredDistance, distancePoints: 0, stayPressurePoints: 0, total,
    suggestedImportance: assessment.magnitude ?? "Low" };
}

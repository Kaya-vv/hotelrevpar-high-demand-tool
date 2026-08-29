export type SourceName =
  | "rijksoverheid"
  | "openholidays"
  | "ticketmaster"
  | "predicthq"
  | "claude"
  | "uefa";

export type EventCandidate = {
  provider: SourceName;
  providerEventId: string;
  sourceUrl: string;
  publicSourceUrl?: string | null;
  title: string;
  category: string;
  venue: string | null;
  latitude: number | null;
  longitude: number | null;
  regionScope: string | null;
  startAt: string;
  endAt: string;
  sourceState: "active" | "predicted" | "cancelled" | "postponed" | "removed";
  providerDuplicateOfId?: string | null;
  providerDeletedReason?: string | null;
  providerCancelledAt?: string | null;
  providerPostponedAt?: string | null;
  certainty: "confirmed" | "provisional";
  localRank: number | null;
  attendance: number | null;
  venueCapacity: number | null;
  aiImpactPoints?: number | null;
  evidenceText: string | null;
  primarySourceConfirmed: boolean;
};

export type NormalizedCandidate = EventCandidate & {
  normalizedTitle: string;
  normalizedIdentity: string;
  localStartDate: string;
};

export type ValidationReason =
  | "missing_source"
  | "missing_fields"
  | "out_of_window"
  | "duplicate_uncertain"
  | "date_conflict"
  | "changed_date"
  | "changed_venue"
  | "cancelled"
  | "postponed"
  | "removed"
  | "missing_primary_evidence";

export type ValidationOutcome = {
  state: "active" | "needs_review" | "excluded";
  reason: ValidationReason | null;
  certainty: EventCandidate["certainty"];
};

export type DemandScore = {
  impactPoints: number;
  impactBasis:
    | "local_rank"
    | "attendance"
    | "venue_capacity"
    | "ai_assessment"
    | "holiday_rule"
    | "default";
  distanceKm: number | null;
  distancePoints: number;
  stayPressurePoints: number;
  total: number;
  suggestedImportance: "Low" | "Medium" | "High" | "Peak";
};

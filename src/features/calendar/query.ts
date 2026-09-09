import { readDemandAssessment } from "@/features/events/demand-assessment";
import { calendarBounds, type OverviewPeriod } from "./navigation";
import { calendarExportDates } from "@/features/export/history";
import { readEventEvidence } from "@/features/events/evidence";
import { eventLocalDate } from "@/features/events/normalize";
import { createServerClient } from "@/lib/supabase/server";
import {
  isAnnouncedLongRange,
  isPublishableDemand,
  publishableReviewEventIds,
  type DemandLevel,
} from "@/features/events/importance";
import { getHotelScope } from "@/features/workspace/hotel-context";
import { fetchAllRows, fetchInBatches, fetchPagedInBatches } from "@/lib/supabase/fetch-in-batches";
import { isEnabledPrimarySource } from "@/features/events/source-evidence";

import type { CalendarEvent, LatestRun } from "./calendar-view";
import type { ReviewEvent } from "@/features/review/review-list";

export type CalendarFilters = {
  month: string;
  view?: "list" | "calendar";
  period?: OverviewPeriod;
  category?: string;
  importance?: DemandLevel;
};

async function loadAccountEvents(
  accountId: string,
  state: "active" | "needs_review",
  linkedIds: Set<string>,
  bounds?: { start: string; end: string },
) {
  const supabase = await createServerClient();
  const decisions = await fetchInBatches([...linkedIds], ids => supabase
    .from("account_events")
    .select("event_id, state, override_title, override_venue, override_start_at, override_end_at, review_target_event_id, review_source_id, review_reason")
    .eq("account_id", accountId).eq("state", state).in("event_id", ids));
  const eventIds = decisions.map(decision => decision.event_id);
  const candidates = await fetchInBatches(eventIds, ids => supabase.from("events")
    .select("id, title, category, venue, start_at, end_at, certainty, latitude, longitude").in("id", ids));
  const byId = new Map(decisions.map(decision => [decision.event_id, decision]));
  // Override dates can move an event into the window. Filter effective dates before
  // loading its much larger evidence and score rows, never on original dates alone.
  const events = candidates.filter(event => {
    const decision = byId.get(event.id);
    return !bounds || (eventLocalDate(decision?.override_start_at ?? event.start_at) <= bounds.end
      && eventLocalDate(decision?.override_end_at ?? event.end_at) >= bounds.start);
  });
  const sources = await fetchPagedInBatches(events.map(event => event.id), (ids, from, to) => supabase.from("event_sources")
    .select("id, event_id, provider, source_state, primary_source_confirmed, public_source_url, evidence, extracted_title, extracted_location, extracted_start_at, extracted_end_at")
    .in("event_id", ids).order("id").range(from, to));
  return { decisions, events, sources };
}

async function linkedEventIds(accountId: string, areaId: string | null) {
  if (!areaId) return new Set<string>();
  const supabase = await createServerClient();
  const data = await fetchAllRows((from, to) => supabase
    .from("account_event_areas")
    .select("event_id")
    .eq("account_id", accountId)
    .eq("collection_area_id", areaId)
    .order("event_id")
    .range(from, to));
  return new Set(data.map((link) => link.event_id));
}

export async function getCalendarData(
  accountId: string,
  filters: CalendarFilters
) {
  const { supabase, hotels, selectedHotelId, areaId, enabledSources } =
    await getHotelScope(accountId);
  const linkedIds = await linkedEventIds(accountId, areaId);
  const bounds = calendarBounds(filters.month, filters.view, filters.period);
  const [{ decisions, events, sources }, runResult] =
    await Promise.all([
      loadAccountEvents(accountId, "active", linkedIds, bounds),
      areaId
        ? supabase
            .from("collection_runs")
            .select("started_at, finished_at, error_summary, source_results")
            .eq("account_id", accountId)
            .eq("collection_area_id", areaId)
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
  if (runResult.error) throw runResult.error;

  const scopedEvents = events.filter((event) => linkedIds.has(event.id));
  const eventIds = scopedEvents.map((event) => event.id);
  const scores =
    eventIds.length && selectedHotelId
      ? await fetchInBatches(eventIds, (ids) =>
          supabase
            .from("hotel_event_scores")
            .select("event_id, hotel_id, total, suggested_importance, importance_override, impact_basis, demand_assessment, impact_points, distance_points, stay_pressure_points, distance_km")
            .in("event_id", ids)
            .eq("hotel_id", selectedHotelId)
        )
      : [];

  const decisionsByEvent = new Map(
    decisions.map((decision) => [decision.event_id, decision])
  );
  const selectedHotelName =
    hotels.find((hotel) => hotel.id === selectedHotelId)?.name ?? "Hotel";
  // Same boundary the collector uses to split near-term verification from long-range research.
  const nearTermHorizon = new Date(Date.now() + 90 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const selectedRadiusKm =
    hotels.find((hotel) => hotel.id === selectedHotelId)?.demand_radius_km ?? null;
  const exportedDates = await calendarExportDates(accountId, selectedHotelId, eventIds);
  const mapped: CalendarEvent[] = scopedEvents
    .filter((event) => event.certainty === "confirmed")
    .map((event) => {
      const decision = decisionsByEvent.get(event.id);
      const publishedSources = sources
        .filter(
          (source) =>
            source.event_id === event.id &&
            isEnabledPrimarySource(source, enabledSources),
        )
        .map((source) => ({
          provider: source.provider,
          url: source.public_source_url,
          state: source.source_state,
          primarySourceConfirmed: source.primary_source_confirmed,
        }));
      const eventScores = scores
        .filter((score) => score.event_id === event.id)
        .map((score) => ({
          hotelId: score.hotel_id,
          hotelName: selectedHotelName,
          total: score.total,
          importance: (score.importance_override ??
            score.suggested_importance) as DemandLevel,
          impactBasis: score.impact_basis,
          assessment: readDemandAssessment(score.demand_assessment),
          impactPoints: score.impact_points,
          distancePoints: score.distance_points,
          stayPressurePoints: score.stay_pressure_points,
          distanceKm: score.distance_km,
        }));
      // The publish gate decides visibility. Requiring a graded demand assessment here hid every
      // event scored from an evidenced proxy, independently of `isPublishableDemand`.
      const hotelScores = eventScores.filter((score) =>
        isPublishableDemand(score.importance, score.impactBasis)
      );
      // Kept even when the publish gate hides the grade: the calendar's manual override
      // updates this row.
      const assessedScore = eventScores[0];
      const announced = isAnnouncedLongRange({
        startDate: eventLocalDate(event.start_at),
        endDate: eventLocalDate(event.end_at),
        nearTermHorizon,
        demandRadiusKm: selectedRadiusKm,
        hasConfirmedDateAndLocation: sources.some((source) => {
          if (source.event_id !== event.id || !isEnabledPrimarySource(source, enabledSources)) return false;
          const evidence = readEventEvidence(source.evidence);
          return Boolean(evidence?.dateText && evidence.locationText);
        }),
        scores: eventScores,
      });
      return {
        id: event.id,
        exportedAt: exportedDates.get(event.id),
        locationApproximate: sources.some((source) => {
          const location = source.event_id === event.id ? readEventEvidence(source.evidence)?.locationResolution : undefined;
          return location?.method === "city_centroid" && location.latitude === event.latitude && location.longitude === event.longitude;
        }),
        title: decision?.override_title ?? event.title,
        category: event.category,
        venue: decision?.override_venue ?? event.venue,
        startAt: decision?.override_start_at ?? event.start_at,
        endAt: decision?.override_end_at ?? event.end_at,
        sources: publishedSources,
        hotelScores,
        announced,
        assessedScore,
        demandAssessment: assessedScore?.assessment,
      };
    })
    .filter((event) => event.sources.length > 0)
    .filter((event) => event.hotelScores.length > 0 || event.announced)
    .filter((event) => eventLocalDate(event.startAt) <= bounds.end && eventLocalDate(event.endAt) >= bounds.start);
  const categories = [...new Set(mapped.map((event) => event.category))].sort();
  const filtered = mapped
    .filter((event) => !filters.category || event.category === filters.category)
    .filter(
      (event) =>
        !filters.importance ||
        event.hotelScores.some(
          (score) => score.importance === filters.importance
        )
    )
    .sort(
      (left, right) =>
        left.startAt.localeCompare(right.startAt) ||
        left.title.localeCompare(right.title, "nl")
    );

  let latestRun: LatestRun | null = null;
  if (runResult.data) {
    const sourceResults = runResult.data.source_results as { claude?: { researchPending?: boolean } } | null;
    let researchPending = Boolean(sourceResults?.claude?.researchPending);
    if (researchPending && areaId) {
      const { data: area, error } = await supabase.from("collection_areas").select("search_location, radius_km").eq("account_id", accountId).eq("id", areaId).single();
      if (error) throw error;
      const { longRangeMarketKey } = await import("../collection/long-range-store");
      const { getMarketStatus } = await import("../collection/market-status");
      const state = await getMarketStatus(longRangeMarketKey(area.search_location, area.radius_km));
      const { researchIsPending } = await import("../collection/research-status");
      researchPending = researchIsPending(true, runResult.data.started_at, state);
    }
    latestRun = {
      startedAt: runResult.data.started_at,
      finishedAt: runResult.data.finished_at,
      hadErrors: Boolean(runResult.data.error_summary),
      researchPending,
    };
  }
  return {
    events: filtered,
    latestRun,
    hotels,
    selectedHotelId,
    categories,
  };
}

export async function getReviewData(accountId: string) {
  const { supabase, hotels, selectedHotelId, areaId } = await getHotelScope(
    accountId
  );
  const linkedIds = await linkedEventIds(accountId, areaId);
  const { decisions, events, sources } = await loadAccountEvents(
    accountId,
    "needs_review",
    linkedIds,
  );
  const decisionsByEvent = new Map(
    decisions.map((decision) => [decision.event_id, decision])
  );
  const reviewEventIds = events
    .filter((event) => linkedIds.has(event.id))
    .map((event) => event.id);
  const scores =
    reviewEventIds.length && selectedHotelId
      ? await fetchInBatches(reviewEventIds, (ids) =>
          supabase
            .from("hotel_event_scores")
            .select("event_id, suggested_importance, importance_override, impact_basis, demand_assessment")
            .in("event_id", ids)
            .eq("hotel_id", selectedHotelId)
        )
      : [];
  const reviewableIds = publishableReviewEventIds(decisions, scores);
  const targetIds = decisions
    .filter((decision) => reviewableIds.has(decision.event_id))
    .map((decision) => decision.review_target_event_id)
    .filter((id): id is string => Boolean(id));
  const targets = targetIds.length
    ? await fetchInBatches(targetIds, (ids) =>
        supabase
          .from("events")
          .select("id, title, venue, start_at, end_at")
          .in("id", ids)
      )
    : [];
  const targetsById = new Map(targets.map((target) => [target.id, target]));
  const reviewEvents: ReviewEvent[] = events
    .filter((event) => linkedIds.has(event.id) && reviewableIds.has(event.id))
    .map((event) => {
      const decision = decisionsByEvent.get(event.id);
      const proposed = sources.find(
        (source) => source.id === decision?.review_source_id
      );
      const target = decision?.review_target_event_id
        ? targetsById.get(decision.review_target_event_id)
        : null;
      return {
        id: event.id,
        title: decision?.override_title ?? event.title,
        venue: decision?.override_venue ?? event.venue,
        startAt: decision?.override_start_at ?? event.start_at,
        endAt: decision?.override_end_at ?? event.end_at,
        reviewReason: decision?.review_reason ?? null,
        proposed: proposed
          ? {
              title: proposed.extracted_title,
              venue: proposed.extracted_location,
              startAt: proposed.extracted_start_at,
              endAt: proposed.extracted_end_at ?? proposed.extracted_start_at,
            }
          : null,
        target: target
          ? {
              title: target.title,
              venue: target.venue,
              startAt: target.start_at,
              endAt: target.end_at,
            }
          : null,
        sources: sources
          .filter((source) => source.event_id === event.id)
          .map((source) => ({
            provider: source.provider,
            url: source.public_source_url,
            state: source.source_state,
            primarySourceConfirmed: source.primary_source_confirmed,
          })),
      };
    });
  return { events: reviewEvents, hotels, selectedHotelId };
}

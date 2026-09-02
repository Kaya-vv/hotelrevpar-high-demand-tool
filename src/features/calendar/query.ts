import { createServerClient } from "@/lib/supabase/server";
import {
  isPublishableDemand,
  type DemandLevel,
} from "@/features/events/importance";
import { getHotelScope } from "@/features/workspace/hotel-context";
import { fetchInBatches } from "@/lib/supabase/fetch-in-batches";

import type { CalendarEvent, LatestRun } from "./calendar-view";
import type { ReviewEvent } from "@/features/review/review-list";

export type CalendarFilters = {
  month: string;
  category?: string;
  maxDistance?: number;
  importance?: DemandLevel;
};

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const end = new Date(Date.UTC(year, monthNumber, 0))
    .toISOString()
    .slice(0, 10);
  return { start: `${month}-01`, end };
}

async function loadAccountEvents(
  accountId: string,
  state: "active" | "needs_review"
) {
  const supabase = await createServerClient();
  const { data: decisions, error: decisionError } = await supabase
    .from("account_events")
    .select("*")
    .eq("account_id", accountId)
    .eq("state", state);
  if (decisionError) throw decisionError;
  const eventIds = decisions.map((decision) => decision.event_id);
  if (!eventIds.length) return { decisions, events: [], sources: [] };

  const [events, sources] = await Promise.all([
    fetchInBatches(eventIds, (ids) =>
      supabase.from("events").select("*").in("id", ids)
    ),
    fetchInBatches(eventIds, (ids) =>
      supabase.from("event_sources").select("*").in("event_id", ids)
    ),
  ]);
  return { decisions, events, sources };
}

async function linkedEventIds(accountId: string, areaId: string | null) {
  if (!areaId) return new Set<string>();
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("account_event_areas")
    .select("event_id")
    .eq("account_id", accountId)
    .eq("collection_area_id", areaId);
  if (error) throw error;
  return new Set(data.map((link) => link.event_id));
}

export async function getCalendarData(
  accountId: string,
  filters: CalendarFilters
) {
  const { supabase, hotels, selectedHotelId, areaId } = await getHotelScope(
    accountId
  );
  const [{ decisions, events, sources }, linkedIds, runResult] =
    await Promise.all([
      loadAccountEvents(accountId, "active"),
      linkedEventIds(accountId, areaId),
      areaId
        ? supabase
            .from("collection_runs")
            .select("started_at, finished_at, error_summary")
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
            .select("*")
            .in("event_id", ids)
            .eq("hotel_id", selectedHotelId)
        )
      : [];

  const decisionsByEvent = new Map(
    decisions.map((decision) => [decision.event_id, decision])
  );
  const selectedHotelName =
    hotels.find((hotel) => hotel.id === selectedHotelId)?.name ?? "Hotel";
  const bounds = monthBounds(filters.month);
  const mapped: CalendarEvent[] = scopedEvents
    .filter(
      (event) =>
        event.certainty === "confirmed" &&
        event.start_at.slice(0, 10) <= bounds.end &&
        event.end_at.slice(0, 10) >= bounds.start
    )
    .map((event) => {
      const decision = decisionsByEvent.get(event.id);
      const hotelScores = scores
        .filter((score) => score.event_id === event.id)
        .map((score) => ({
          hotelId: score.hotel_id,
          hotelName: selectedHotelName,
          total: score.total,
          importance: (score.importance_override ??
            score.suggested_importance) as DemandLevel,
          impactBasis: score.impact_basis,
          impactPoints: score.impact_points,
          distancePoints: score.distance_points,
          stayPressurePoints: score.stay_pressure_points,
          distanceKm: score.distance_km,
        }))
        .filter((score) =>
          isPublishableDemand(score.importance, score.impactBasis)
        );
      return {
        id: event.id,
        title: decision?.override_title ?? event.title,
        category: event.category,
        venue: decision?.override_venue ?? event.venue,
        startAt: decision?.override_start_at ?? event.start_at,
        endAt: decision?.override_end_at ?? event.end_at,
        sources: sources
          .filter((source) => source.event_id === event.id)
          .map((source) => ({
            provider: source.provider,
            url: source.public_source_url,
            state: source.source_state,
            primarySourceConfirmed: source.primary_source_confirmed,
          })),
        hotelScores,
      };
    })
    .filter((event) => event.hotelScores.length > 0)
    .filter((event) => !filters.category || event.category === filters.category)
    .filter(
      (event) =>
        filters.maxDistance === undefined ||
        event.hotelScores.some(
          (score) =>
            score.distanceKm === null ||
            score.distanceKm <= filters.maxDistance!
        )
    )
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
    latestRun = {
      startedAt: runResult.data.started_at,
      finishedAt: runResult.data.finished_at,
      hadErrors: Boolean(runResult.data.error_summary),
    };
  }
  return {
    events: mapped,
    latestRun,
    hotels,
    selectedHotelId,
    categories: [
      ...new Set(scopedEvents.map((event) => event.category)),
    ].sort(),
  };
}

export async function getReviewData(accountId: string) {
  const { supabase, hotels, selectedHotelId, areaId } = await getHotelScope(
    accountId
  );
  const linkedIds = await linkedEventIds(accountId, areaId);
  const { decisions, events, sources } = await loadAccountEvents(
    accountId,
    "needs_review"
  );
  const decisionsByEvent = new Map(
    decisions.map((decision) => [decision.event_id, decision])
  );
  const targetIds = decisions
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
    .filter((event) => linkedIds.has(event.id))
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

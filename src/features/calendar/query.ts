import { createServerClient } from "@/lib/supabase/server";

import type { CalendarEvent, LatestRun } from "./calendar-view";
import type { ReviewEvent } from "@/features/review/review-list";

export type CalendarFilters = {
  month: string;
  hotel?: string;
  category?: string;
  maxDistance?: number;
  importance?: "Low" | "Medium" | "High";
};

function monthBounds(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const end = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  return { start: `${month}-01`, end };
}

async function loadAccountEvents(accountId: string, state: "active" | "needs_review") {
  const supabase = await createServerClient();
  const { data: decisions, error: decisionError } = await supabase
    .from("account_events")
    .select("*")
    .eq("account_id", accountId)
    .eq("state", state);
  if (decisionError) throw decisionError;
  const eventIds = decisions.map((decision) => decision.event_id);
  if (!eventIds.length) return { decisions, events: [], sources: [] };

  const [eventResult, sourceResult] = await Promise.all([
    supabase.from("events").select("*").in("id", eventIds),
    supabase.from("event_sources").select("*").in("event_id", eventIds),
  ]);
  if (eventResult.error) throw eventResult.error;
  if (sourceResult.error) throw sourceResult.error;
  return { decisions, events: eventResult.data, sources: sourceResult.data };
}

async function hotelScope(accountId: string, requestedHotelId?: string) {
  const supabase = await createServerClient();
  const { data: hotels, error: hotelError } = await supabase
    .from("hotels")
    .select("id, name")
    .eq("account_id", accountId)
    .order("name");
  if (hotelError) throw hotelError;
  const selectedHotelId = hotels.some((hotel) => hotel.id === requestedHotelId) ? requestedHotelId! : hotels[0]?.id ?? null;
  if (!selectedHotelId) return { supabase, hotels, selectedHotelId, areaId: null };
  const { data: area, error: areaError } = await supabase
    .from("collection_areas")
    .select("id")
    .eq("account_id", accountId)
    .eq("hotel_id", selectedHotelId)
    .maybeSingle();
  if (areaError) throw areaError;
  return { supabase, hotels, selectedHotelId, areaId: area?.id ?? null };
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

export async function getCalendarData(accountId: string, filters: CalendarFilters) {
  const { supabase, hotels, selectedHotelId, areaId } = await hotelScope(accountId, filters.hotel);
  const [{ decisions, events, sources }, linkedIds, runResult] = await Promise.all([
    loadAccountEvents(accountId, "active"),
    linkedEventIds(accountId, areaId),
    areaId ? supabase
      .from("collection_runs")
      .select("started_at, finished_at, error_summary")
      .eq("account_id", accountId)
      .eq("collection_area_id", areaId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (runResult.error) throw runResult.error;

  const scopedEvents = events.filter((event) => linkedIds.has(event.id));
  const eventIds = scopedEvents.map((event) => event.id);
  const { data: scores, error: scoreError } = eventIds.length && selectedHotelId
    ? await supabase.from("hotel_event_scores").select("*").in("event_id", eventIds).eq("hotel_id", selectedHotelId)
    : { data: [], error: null };
  if (scoreError) throw scoreError;

  const decisionsByEvent = new Map(decisions.map((decision) => [decision.event_id, decision]));
  const selectedHotelName = hotels.find((hotel) => hotel.id === selectedHotelId)?.name ?? "Hotel";
  const bounds = monthBounds(filters.month);
  const mapped: CalendarEvent[] = scopedEvents
    .filter((event) => event.start_at.slice(0, 10) <= bounds.end && event.end_at.slice(0, 10) >= bounds.start)
    .map((event) => {
      const decision = decisionsByEvent.get(event.id);
      const hotelScores = scores
        .filter((score) => score.event_id === event.id)
        .map((score) => ({
          hotelId: score.hotel_id,
          hotelName: selectedHotelName,
          total: score.total,
          importance: (score.importance_override ?? score.suggested_importance) as "Low" | "Medium" | "High",
          impactBasis: score.impact_basis,
          impactPoints: score.impact_points,
          distancePoints: score.distance_points,
          stayPressurePoints: score.stay_pressure_points,
          distanceKm: score.distance_km,
        }));
      return {
        id: event.id,
        title: decision?.override_title ?? event.title,
        category: event.category,
        venue: decision?.override_venue ?? event.venue,
        startAt: decision?.override_start_at ?? event.start_at,
        endAt: decision?.override_end_at ?? event.end_at,
        certainty: event.certainty,
        sources: sources.filter((source) => source.event_id === event.id).map((source) => ({
          provider: source.provider,
          url: source.source_url,
          state: source.source_state,
          primarySourceConfirmed: source.primary_source_confirmed,
        })),
        hotelScores,
      };
    })
    .filter((event) => event.hotelScores.length > 0)
    .filter((event) => !filters.category || event.category === filters.category)
    .filter((event) => filters.maxDistance === undefined || event.hotelScores.some((score) => score.distanceKm === null || score.distanceKm <= filters.maxDistance!))
    .filter((event) => !filters.importance || event.hotelScores.some((score) => score.importance === filters.importance));

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
    categories: [...new Set(scopedEvents.map((event) => event.category))].sort(),
  };
}

export async function getReviewData(accountId: string, requestedHotelId?: string) {
  const { hotels, selectedHotelId, areaId } = await hotelScope(accountId, requestedHotelId);
  const linkedIds = await linkedEventIds(accountId, areaId);
  const { decisions, events, sources } = await loadAccountEvents(accountId, "needs_review");
  const decisionsByEvent = new Map(decisions.map((decision) => [decision.event_id, decision]));
  const reviewEvents: ReviewEvent[] = events.filter((event) => linkedIds.has(event.id)).map((event) => {
    const decision = decisionsByEvent.get(event.id);
    return {
      id: event.id,
      title: decision?.override_title ?? event.title,
      venue: decision?.override_venue ?? event.venue,
      startAt: decision?.override_start_at ?? event.start_at,
      endAt: decision?.override_end_at ?? event.end_at,
      reviewReason: decision?.review_reason ?? null,
      sources: sources.filter((source) => source.event_id === event.id).map((source) => ({
        provider: source.provider,
        url: source.source_url,
        state: source.source_state,
        primarySourceConfirmed: source.primary_source_confirmed,
      })),
    };
  });
  return { events: reviewEvents, hotels, selectedHotelId };
}

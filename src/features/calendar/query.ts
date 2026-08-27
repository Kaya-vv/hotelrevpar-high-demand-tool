import { createServerClient } from "@/lib/supabase/server";

import type { CalendarEvent, LatestRun } from "./calendar-view";
import type { ReviewEvent } from "@/features/review/review-list";

export type CalendarFilters = {
  month: string;
  hotel?: string;
  area?: string;
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

export async function getCalendarData(accountId: string, filters: CalendarFilters) {
  const supabase = await createServerClient();
  const [{ decisions, events, sources }, hotelsResult, areasResult, runResult] = await Promise.all([
    loadAccountEvents(accountId, "active"),
    supabase.from("hotels").select("id, name").eq("account_id", accountId).order("name"),
    supabase.from("collection_areas").select("id, name").eq("account_id", accountId).order("name"),
    supabase
      .from("collection_runs")
      .select("finished_at, source_results")
      .eq("account_id", accountId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (hotelsResult.error) throw hotelsResult.error;
  if (areasResult.error) throw areasResult.error;
  if (runResult.error) throw runResult.error;

  let allowedAreaEvents: Set<string> | null = null;
  if (filters.area) {
    const { data, error } = await supabase
      .from("account_event_areas")
      .select("event_id")
      .eq("account_id", accountId)
      .eq("collection_area_id", filters.area);
    if (error) throw error;
    allowedAreaEvents = new Set(data.map((row) => row.event_id));
  }

  const eventIds = events.map((event) => event.id);
  const hotelIds = hotelsResult.data.map((hotel) => hotel.id);
  const { data: scores, error: scoreError } = eventIds.length && hotelIds.length
    ? await supabase.from("hotel_event_scores").select("*").in("event_id", eventIds).in("hotel_id", hotelIds)
    : { data: [], error: null };
  if (scoreError) throw scoreError;

  const decisionsByEvent = new Map(decisions.map((decision) => [decision.event_id, decision]));
  const hotelsById = new Map(hotelsResult.data.map((hotel) => [hotel.id, hotel.name]));
  const bounds = monthBounds(filters.month);
  const mapped: CalendarEvent[] = events
    .filter((event) => event.start_at.slice(0, 10) <= bounds.end && event.end_at.slice(0, 10) >= bounds.start)
    .filter((event) => !allowedAreaEvents || allowedAreaEvents.has(event.id))
    .map((event) => {
      const decision = decisionsByEvent.get(event.id);
      const hotelScores = scores
        .filter((score) => score.event_id === event.id)
        .map((score) => ({
          hotelId: score.hotel_id,
          hotelName: hotelsById.get(score.hotel_id) ?? "Hotel",
          total: score.total,
          importance: (score.importance_override ?? score.suggested_importance) as "Low" | "Medium" | "High",
          impactBasis: score.impact_basis,
          impactPoints: score.impact_points,
          distancePoints: score.distance_points,
          stayPressurePoints: score.stay_pressure_points,
          distanceKm: score.distance_km,
        }))
        .filter((score) => !filters.hotel || score.hotelId === filters.hotel);
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
    .filter((event) => !filters.hotel || event.hotelScores.length > 0)
    .filter((event) => !filters.category || event.category === filters.category)
    .filter((event) => filters.maxDistance === undefined || event.hotelScores.some((score) => score.distanceKm === null || score.distanceKm <= filters.maxDistance!))
    .filter((event) => !filters.importance || event.hotelScores.some((score) => score.importance === filters.importance));

  let latestRun: LatestRun | null = null;
  if (runResult.data) {
    const finishedAt = runResult.data.finished_at;
    const stale = !finishedAt || Date.now() - new Date(finishedAt).getTime() > 8 * 24 * 60 * 60 * 1000;
    const runSources = (runResult.data.source_results ?? {}) as LatestRun["sources"];
    latestRun = {
      finishedAt,
      sources: stale
        ? Object.fromEntries(Object.entries(runSources).map(([source, result]) => [source, { ...result, state: "stale" }]))
        : runSources,
    };
  }
  return {
    events: mapped,
    latestRun,
    hotels: hotelsResult.data,
    areas: areasResult.data,
    categories: [...new Set(events.map((event) => event.category))].sort(),
  };
}

export async function getReviewEvents(accountId: string): Promise<ReviewEvent[]> {
  const { decisions, events, sources } = await loadAccountEvents(accountId, "needs_review");
  const decisionsByEvent = new Map(decisions.map((decision) => [decision.event_id, decision]));
  return events.map((event) => {
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
}

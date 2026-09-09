import { createServerClient } from "@/lib/supabase/server";
import { fetchAllRows, fetchInBatches, fetchPagedInBatches } from "@/lib/supabase/fetch-in-batches";
import { publishableReviewEventIds } from "@/features/events/importance";

export type DashboardHotel = {
  id: string;
  name: string;
  nextDemand: { id: string; title: string; startAt: string; importance: "High" | "Peak" } | null;
  reviewCount: number;
  updatedAt: string | null;
  status: "idle" | "running" | "attention";
};

export async function getDashboardData(accountId: string): Promise<DashboardHotel[]> {
  const supabase = await createServerClient();
  const hotels = await fetchAllRows((from, to) => supabase.from("hotels").select("id, name")
    .eq("account_id", accountId).order("name").order("id").range(from, to));
  if (!hotels.length) return [];

  const hotelIds = hotels.map((hotel) => hotel.id);
  const areas = await fetchInBatches(hotelIds, ids => supabase.from("collection_areas")
    .select("id, hotel_id, collection_runs(finished_at, error_summary), collection_jobs(status)")
    .eq("account_id", accountId).in("hotel_id", ids)
    .order("started_at", { referencedTable: "collection_runs", ascending: false })
    .limit(1, { referencedTable: "collection_runs" })
    .order("created_at", { referencedTable: "collection_jobs", ascending: false })
    .limit(1, { referencedTable: "collection_jobs" }));
  const areaIds = areas.map(area => area.id);
  const links = await fetchPagedInBatches(areaIds, (ids, from, to) => supabase.from("account_event_areas")
    .select("collection_area_id, event_id").eq("account_id", accountId).in("collection_area_id", ids)
    .order("collection_area_id").order("event_id").range(from, to));
  const eventIds = [...new Set(links.map(link => link.event_id))];
  const [decisions, scores] = await Promise.all([
    fetchInBatches(eventIds, ids => supabase.from("account_events").select("event_id, state, override_title, override_start_at, override_end_at")
      .eq("account_id", accountId).in("event_id", ids).in("state", ["active", "needs_review"])),
    fetchPagedInBatches(eventIds, (ids, from, to) => supabase.from("hotel_event_scores").select("hotel_id, event_id, suggested_importance, importance_override, impact_basis")
      .in("hotel_id", hotelIds).in("event_id", ids).order("hotel_id").order("event_id").range(from, to)),
  ]);
  const runs = areas.flatMap(area => area.collection_runs.map(run => ({ ...run, collection_area_id: area.id })));
  const activeJobs = areas.flatMap(area => area.collection_jobs.map(job => ({ ...job, collection_area_id: area.id })));
  const activeEventIds = decisions.filter((decision) => decision.state === "active").map((decision) => decision.event_id);
  const events = activeEventIds.length
    ? await fetchInBatches(activeEventIds, (ids) => supabase
        .from("events")
        .select("id, title, start_at")
        .in("id", ids)
        .gte("end_at", new Date().toISOString())
        .order("start_at"))
    : [];

  const decisionsByEvent = new Map(decisions.map((decision) => [decision.event_id, decision]));
  const eventById = new Map(events.map((event) => {
    const decision = decisionsByEvent.get(event.id);
    return [event.id, {
      ...event,
      title: decision?.override_title ?? event.title,
      start_at: decision?.override_start_at ?? event.start_at,
    }];
  }));
  const reviewIds = new Set(decisions.filter((decision) => decision.state === "needs_review").map((decision) => decision.event_id));
  const areaByHotel = new Map(areas.map((area) => [area.hotel_id!, area.id]));
  const linksByArea = new Map<string, Set<string>>();
  links.forEach((link) => {
    const eventsForArea = linksByArea.get(link.collection_area_id) ?? new Set<string>();
    eventsForArea.add(link.event_id);
    linksByArea.set(link.collection_area_id, eventsForArea);
  });

  return hotels.map((hotel) => {
    const areaId = areaByHotel.get(hotel.id);
    const linkedIds = areaId ? linksByArea.get(areaId) ?? new Set<string>() : new Set<string>();
    const hotelScores = scores.filter((score) => score.hotel_id === hotel.id);
    const reviewableIds = publishableReviewEventIds(decisions, hotelScores);
    const nextScore = hotelScores
      .filter((score) => linkedIds.has(score.event_id) && eventById.has(score.event_id))
      .map((score) => ({ ...score, importance: score.importance_override ?? score.suggested_importance }))
      .filter((score) => score.importance === "High" || score.importance === "Peak")
      .sort((left, right) => eventById.get(left.event_id)!.start_at.localeCompare(eventById.get(right.event_id)!.start_at))[0];
    const nextEvent = nextScore ? eventById.get(nextScore.event_id)! : null;
    const latestRun = areaId ? runs.find((run) => run.collection_area_id === areaId) : null;
    const latestJob = areaId ? activeJobs.find((job) => job.collection_area_id === areaId) : null;
    return {
      id: hotel.id,
      name: hotel.name,
      nextDemand: nextEvent ? {
        id: nextEvent.id,
        title: nextEvent.title,
        startAt: nextEvent.start_at,
        importance: nextScore!.importance as "High" | "Peak",
      } : null,
      reviewCount: [...linkedIds].filter((eventId) => reviewIds.has(eventId) && reviewableIds.has(eventId)).length,
      updatedAt: latestRun?.finished_at ?? null,
      status: latestJob?.status === "queued" || latestJob?.status === "running"
        ? "running"
        : latestJob?.status === "failed" || Boolean(latestRun?.error_summary)
          ? "attention"
          : "idle",
    };
  });
}

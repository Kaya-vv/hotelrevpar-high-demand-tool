import { createServerClient } from "@/lib/supabase/server";
import { fetchInBatches } from "@/lib/supabase/fetch-in-batches";

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
  const { data: hotels, error: hotelError } = await supabase
    .from("hotels")
    .select("id, name")
    .eq("account_id", accountId)
    .order("name");
  if (hotelError) throw hotelError;
  if (!hotels.length) return [];

  const hotelIds = hotels.map((hotel) => hotel.id);
  const { data: areas, error: areaError } = await supabase
    .from("collection_areas")
    .select("id, hotel_id")
    .eq("account_id", accountId)
    .in("hotel_id", hotelIds);
  if (areaError) throw areaError;
  const areaIds = areas.map((area) => area.id);

  const [linksResult, decisionsResult, scoresResult, runsResult, jobsResult] = await Promise.all([
    areaIds.length
      ? supabase.from("account_event_areas").select("collection_area_id, event_id").eq("account_id", accountId).in("collection_area_id", areaIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("account_events").select("event_id, state, override_title, override_start_at, override_end_at").eq("account_id", accountId).in("state", ["active", "needs_review"]),
    supabase.from("hotel_event_scores").select("hotel_id, event_id, suggested_importance, importance_override").in("hotel_id", hotelIds),
    areaIds.length
      ? supabase.from("collection_runs").select("collection_area_id, finished_at, error_summary").eq("account_id", accountId).in("collection_area_id", areaIds).order("started_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    areaIds.length
      ? supabase.from("collection_jobs").select("collection_area_id, status").eq("account_id", accountId).in("collection_area_id", areaIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [linksResult, decisionsResult, scoresResult, runsResult, jobsResult]) {
    if (result.error) throw result.error;
  }

  const decisions = decisionsResult.data ?? [];
  const links = linksResult.data ?? [];
  const scores = scoresResult.data ?? [];
  const runs = runsResult.data ?? [];
  const activeJobs = jobsResult.data ?? [];
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
    const nextScore = scores
      .filter((score) => score.hotel_id === hotel.id && linkedIds.has(score.event_id) && eventById.has(score.event_id))
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
      reviewCount: [...linkedIds].filter((eventId) => reviewIds.has(eventId)).length,
      updatedAt: latestRun?.finished_at ?? null,
      status: latestJob?.status === "queued" || latestJob?.status === "running"
        ? "running"
        : latestJob?.status === "failed" || latestJob?.status === "partial" || Boolean(latestRun?.error_summary)
          ? "attention"
          : "idle",
    };
  });
}

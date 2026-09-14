import { readEventEvidence } from "@/features/events/evidence";
import { eventLocalDate } from "@/features/events/normalize";
import { fetchAllRows, fetchInBatches } from "@/lib/supabase/fetch-in-batches";
import { createServerClient } from "@/lib/supabase/server";

export type UnresolvedLocation = {
  areaId: string;
  areaName: string;
  provider: string;
  providerEventId: string;
  horizon: "near_term" | "long_range";
  title: string;
  venue: string | null;
  startDate: string;
  endDate: string;
  discoveredAt: string;
  sourceUrl: string | null;
  locationText: string | null;
  hostCity: string | null;
};

function candidateDetails(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { sourceUrl: null, locationText: null, hostCity: null };
  }
  const candidate = value as Record<string, unknown>;
  const evidence = readEventEvidence(candidate.evidence);
  return {
    sourceUrl: typeof candidate.sourceUrl === "string" ? candidate.sourceUrl : null,
    locationText: evidence?.locationText.trim() || null,
    hostCity: evidence?.hostCity ?? null,
  };
}

export async function unresolvedEventLocations(
  accountId: string,
): Promise<UnresolvedLocation[]> {
  const supabase = await createServerClient();
  const areas = await fetchAllRows((from, to) =>
    supabase
      .from("collection_areas")
      .select("id, name")
      .eq("account_id", accountId)
      .order("id")
      .range(from, to),
  );
  if (!areas.length) return [];

  const rows = await fetchInBatches(
    areas.map((area) => area.id),
    (areaIds) =>
      supabase
        .from("unresolved_event_locations")
        .select(
          "collection_area_id, provider, provider_event_id, horizon, title, venue, start_at, end_at, discovered_at, candidate",
        )
        .is("resolved_at", null)
        .in("collection_area_id", areaIds),
  );
  const areaNames = new Map(areas.map((area) => [area.id, area.name]));
  return rows
    .map((row) => ({
      areaId: row.collection_area_id,
      areaName: areaNames.get(row.collection_area_id) ?? "",
      provider: row.provider,
      providerEventId: row.provider_event_id,
      horizon: row.horizon as UnresolvedLocation["horizon"],
      title: row.title,
      venue: row.venue,
      startDate: eventLocalDate(row.start_at),
      endDate: eventLocalDate(row.end_at),
      discoveredAt: row.discovered_at,
      ...candidateDetails(row.candidate),
    }))
    .sort(
      (left, right) =>
        left.startDate.localeCompare(right.startDate) ||
        left.title.localeCompare(right.title),
    );
}

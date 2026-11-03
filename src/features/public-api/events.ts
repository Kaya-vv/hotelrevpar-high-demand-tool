import { trialHorizonEnd } from "@/features/accounts/trial";
import type { DemandLevel } from "@/features/events/importance";
import { eventLocalDate } from "@/features/events/normalize";
import { isEnabledPrimarySource } from "@/features/events/source-evidence";
import { isDate, loadExportEvents } from "@/features/export/query";
import { exportedLevel } from "@/features/export/selection";
import type { AdminClient } from "@/lib/supabase/admin";
import { fetchInBatches, fetchPagedInBatches } from "@/lib/supabase/fetch-in-batches";

import type { ApiAccount } from "./keys";
import { apiError, type ApiError } from "./respond";

export const API_LEVELS = ["Low", "Medium", "High", "Peak"] as const satisfies readonly DemandLevel[];

export type EventsQuery = { hotelId: string | null; from: string; to: string; minLevel: DemandLevel };

export type ApiEvent = {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  category: string;
  venue: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  distance_km: number | null;
  level: DemandLevel;
  score: number;
  source_url: string | null;
  hotel_code: string | null;
  updated_at: string;
};

const MAX_SPAN_DAYS = 1096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Production stores scope words and holiday regions in `region_scope`; none of them is a city.
const NOT_A_CITY: Record<string, true> = {
  national: true, international: true, local: true, regional: true, north: true,
  middle: true, south: true, venue: true, citywide: true, unknown: true,
};

const invalid = (message: string) => apiError(400, "invalid_request", message);

export function parseEventsQuery(params: URLSearchParams): EventsQuery | ApiError {
  const from = params.get("from"), to = params.get("to");
  if (!isDate(from) || !isDate(to)) return invalid("from and to are required as YYYY-MM-DD.");
  if (from > to) return invalid("from must not be after to.");
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_SPAN_DAYS) return invalid("The period may cover at most 3 years.");
  const rawLevel = params.get("min_level");
  const minLevel = rawLevel === null ? "Low" : API_LEVELS.find((level) => level.toLowerCase() === rawLevel.toLowerCase());
  if (!minLevel) return invalid("min_level must be Low, Medium, High or Peak.");
  return { hotelId: params.get("hotel_id"), from, to, minLevel };
}

/** The last date DemandRadar searches for this account: a trial's near-term window, else the end of next year. */
export function availableUntil(trialEndsAt: string | null, now = new Date()): string {
  return trialHorizonEnd(trialEndsAt, now) ?? `${now.getUTCFullYear() + 1}-12-31`;
}

export async function loadApiHotels(client: AdminClient, accountId: string) {
  const { data, error } = await client.from("hotels").select("id, name, address, revcontrol_code")
    .eq("account_id", accountId).is("archived_at", null).order("name");
  if (error) throw error;
  return data.map((hotel) => ({ id: hotel.id, name: hotel.name, address: hotel.address, hotel_code: hotel.revcontrol_code || null }));
}

export async function resolveHotel(client: AdminClient, accountId: string, hotelId: string | null): Promise<{ id: string } | ApiError> {
  if (hotelId === null) {
    const { data, error } = await client.from("hotels").select("id").eq("account_id", accountId).is("archived_at", null);
    if (error) throw error;
    if (data.length === 1) return { id: data[0].id };
    if (!data.length) return apiError(404, "hotel_not_found", "This account has no hotels.");
    return apiError(400, "hotel_id_required", "This account has several hotels; pass hotel_id (see GET /api/v1/hotels).");
  }
  const notFound = apiError(404, "hotel_not_found", "Unknown hotel_id for this account.");
  if (!UUID.test(hotelId)) return notFound;
  const { data, error } = await client.from("hotels").select("id")
    .eq("id", hotelId).eq("account_id", accountId).is("archived_at", null).maybeSingle();
  if (error) throw error;
  return data ? { id: data.id } : notFound;
}

/** The hotel's events in the Excel export's selection, as the API returns them. */
export async function loadApiEvents(client: AdminClient, account: ApiAccount, hotelId: string, query: EventsQuery, now = new Date()): Promise<ApiEvent[]> {
  const until = availableUntil(account.trialEndsAt, now);
  const end = query.to < until ? query.to : until;
  if (end < query.from) return [];

  const { events } = await loadExportEvents(account.accountId, { start: query.from, end }, [hotelId], false, client);
  const minRank = API_LEVELS.indexOf(query.minLevel);
  const selected = events.flatMap((event) => {
    const hotel = event.hotels.find((candidate) => candidate.id === hotelId);
    const level = hotel ? exportedLevel(hotel) : null;
    return hotel && level && API_LEVELS.indexOf(level) >= minRank ? [{ event, hotel, level }] : [];
  });
  if (!selected.length) return [];

  const ids = selected.map(({ event }) => event.id);
  const [details, decisions, scores, sources, area] = await Promise.all([
    fetchInBatches(ids, (batch) => client.from("events").select("id, category, venue, latitude, longitude, region_scope, updated_at").in("id", batch)),
    fetchInBatches(ids, (batch) => client.from("account_events").select("event_id, override_venue, decided_at").eq("account_id", account.accountId).in("event_id", batch)),
    fetchInBatches(ids, (batch) => client.from("hotel_event_scores").select("event_id, total, distance_km").eq("hotel_id", hotelId).in("event_id", batch)),
    fetchPagedInBatches(ids, (batch, from, to) => client.from("event_sources")
      .select("event_id, provider, source_state, primary_source_confirmed, public_source_url, checked_at").in("event_id", batch).order("id").range(from, to)),
    client.from("collection_areas").select("enabled_sources").eq("hotel_id", hotelId).single(),
  ]);
  if (area.error) throw area.error;
  const enabledSources = area.data.enabled_sources;
  const detailById = new Map(details.map((row) => [row.id, row]));
  const decisionById = new Map(decisions.map((row) => [row.event_id, row]));
  const scoreById = new Map(scores.map((row) => [row.event_id, row]));

  return selected.map(({ event, hotel, level }): ApiEvent => {
    const detail = detailById.get(event.id);
    const decision = decisionById.get(event.id);
    const score = scoreById.get(event.id);
    const source = sources
      .filter((row) => row.event_id === event.id && isEnabledPrimarySource(row, enabledSources))
      .sort((left, right) => right.checked_at.localeCompare(left.checked_at))[0];
    const scope = detail?.region_scope ?? null;
    const updated = Math.max(Date.parse(detail?.updated_at ?? ""), Date.parse(decision?.decided_at ?? "")) || 0;
    return {
      id: event.id,
      title: event.title,
      start_date: eventLocalDate(event.startAt),
      end_date: eventLocalDate(event.endAt),
      category: detail?.category ?? "",
      venue: decision?.override_venue ?? detail?.venue ?? null,
      city: scope && !Object.hasOwn(NOT_A_CITY, scope.toLowerCase()) ? scope : null,
      latitude: detail?.latitude ?? null,
      longitude: detail?.longitude ?? null,
      distance_km: score?.distance_km == null ? null : Math.round(score.distance_km * 10) / 10,
      level,
      score: score?.total ?? 0,
      source_url: source?.public_source_url ?? null,
      hotel_code: hotel.code || null,
      updated_at: new Date(updated).toISOString(),
    };
  }).sort((left, right) => left.start_date.localeCompare(right.start_date) || left.title.localeCompare(right.title, "nl"));
}

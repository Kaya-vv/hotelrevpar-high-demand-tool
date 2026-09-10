import { eventLocalDate } from "@/features/events/normalize";
import { readEventEvidence } from "@/features/events/evidence";
import { isAnnouncedLongRange, type DemandLevel } from "@/features/events/importance";
import { createServerClient } from "@/lib/supabase/server";
import { fetchAllRows, fetchInBatches, fetchPagedInBatches } from "@/lib/supabase/fetch-in-batches";
import { isEnabledPrimarySource } from "@/features/events/source-evidence";

import type { ExportEvent } from "./types";


const isDate = (value: string | null | undefined): value is string => {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value ?? "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export type ExportRange = { start: string; end: string };

/**
 * Default to the full research horizon; explicit date selections remain supported.
 */
export function exportRange(
  from: string | null | undefined,
  to: string | null | undefined,
  today = new Date(),
): ExportRange {
  const start = isDate(from) ? from : today.toISOString().slice(0, 10);
  const fallbackEnd = `${today.getUTCFullYear() + 1}-12-31`;
  const end = isDate(to) ? to : fallbackEnd;
  return end < start ? { start: end, end: start } : { start, end };
}

export async function loadExportEvents(accountId: string, range: ExportRange, selectedHotelIds: string[], includeInactive = false) {
  const supabase = await createServerClient();
  const { data: hotels, error: hotelError } = await supabase
    .from("hotels")
    .select("id, name, revcontrol_code, demand_radius_km")
    .eq("account_id", accountId)
    .in("id", selectedHotelIds);
  if (hotelError) throw hotelError;
  if (hotels.length !== selectedHotelIds.length) throw new Error("Een geselecteerd hotel hoort niet bij dit account.");
  const { data: areas, error: areaError } = await supabase
    .from("collection_areas")
    .select("id, hotel_id, enabled_sources")
    .eq("account_id", accountId)
    .in("hotel_id", selectedHotelIds);
  if (areaError) throw areaError;

  const areaIds = areas.map(area => area.id);
  const links = await fetchPagedInBatches(areaIds, (ids, from, to) => supabase.from("account_event_areas")
    .select("event_id, collection_area_id").eq("account_id", accountId).in("collection_area_id", ids).order("collection_area_id").order("event_id").range(from, to));
  // History also needs formerly linked canonical events to report changed/unavailable exports.
  const historic = includeInactive ? await fetchAllRows((from, to) => supabase.from("hotel_event_exports")
    .select("event_id, canonical_event_id").eq("account_id", accountId).in("hotel_id", selectedHotelIds).order("hotel_id").order("event_id").range(from, to)) : [];
  const scopedIds = [...new Set([...links.map(link => link.event_id), ...historic.flatMap(claim => [claim.event_id, claim.canonical_event_id])])];
  const decisions = await fetchInBatches(scopedIds, ids => supabase.from("account_events")
    .select("event_id, state, merged_into_event_id, override_title, override_start_at, override_end_at")
    .eq("account_id", accountId).in("event_id", ids));
  const datesById = new Map(decisions.map(decision => [decision.event_id, decision]));
  const candidates = await fetchInBatches(decisions.map(decision => decision.event_id), ids => supabase.from("events")
    .select("id, title, start_at, end_at, certainty, source_state, category").in("id", ids));
  const exportEvents = candidates.filter(event => {
    const decision = datesById.get(event.id);
    return includeInactive || (eventLocalDate(decision?.override_start_at ?? event.start_at) <= range.end
      && eventLocalDate(decision?.override_end_at ?? event.end_at) >= range.start);
  });
  const eventIds = exportEvents.map(event => event.id);
  const [scores, sources] = await Promise.all([
    fetchPagedInBatches(eventIds, (ids, from, to) => supabase.from("hotel_event_scores").select("event_id, hotel_id, suggested_importance, importance_override, impact_basis, distance_km, demand_assessment").in("event_id", ids).in("hotel_id", selectedHotelIds).order("hotel_id").order("event_id").range(from, to)),
    fetchPagedInBatches(eventIds, (ids, from, to) => supabase.from("event_sources").select("event_id, provider, source_state, primary_source_confirmed, public_source_url, evidence").in("event_id", ids).order("id").range(from, to)),
  ]);
  const decisionsByEvent = new Map(decisions.map((decision) => [decision.event_id, decision]));
  const hotelCodes = new Map(hotels.map((hotel) => [hotel.id, hotel.revcontrol_code]));
  const areaByHotel = new Map(areas.map((area) => [area.hotel_id, area]));
  const linkedEvents = new Set(links.map((link) => `${link.collection_area_id}:${link.event_id}`));
  const supported = (eventId: string, hotelId: string) => {
    const area = areaByHotel.get(hotelId);
    return Boolean(
      area &&
      linkedEvents.has(`${area.id}:${eventId}`) &&
      sources.some(
        (source) =>
          source.event_id === eventId &&
          isEnabledPrimarySource(source, area.enabled_sources),
      )
    );
  };
  const choices = await fetchAllRows((from, to) => supabase.from("announcement_export_choices").select("event_id, hotel_id, importance").eq("account_id", accountId).in("hotel_id", selectedHotelIds).order("hotel_id").order("event_id").range(from, to));
  const claims = await fetchAllRows((from, to) => supabase.from("hotel_event_exports").select("event_id, hotel_id, latest_batch_id").eq("account_id", accountId).in("hotel_id", selectedHotelIds).order("hotel_id").order("event_id").range(from, to));
  const batchIds = [...new Set(claims.map((claim) => claim.latest_batch_id))];
  const batches = batchIds.length ? await fetchInBatches(batchIds, (ids) => supabase.from("export_batches").select("id, created_at").in("id", ids)) : [];
  const events: ExportEvent[] = exportEvents.map((event) => {
    const decision = decisionsByEvent.get(event.id);
    const startAt = decision?.override_start_at ?? event.start_at;
    const endAt = decision?.override_end_at ?? event.end_at;
    const active = decision?.state === "active" && !decision.merged_into_event_id && event.source_state === "active" && event.certainty === "confirmed";
    return {
      id: event.id, title: decision?.override_title ?? event.title, startAt, endAt,
      status: active ? "active" : event.source_state !== "active" ? event.source_state : decision?.state ?? "unavailable",
      hotels: scores.filter((score) => score.event_id === event.id).map((score) => {
        const hotel = hotels.find((hotel) => hotel.id === score.hotel_id)!;
        const importance = (score.importance_override ?? score.suggested_importance) as DemandLevel;
        const available = active && supported(event.id, score.hotel_id);
        const announced = available && isAnnouncedLongRange({
          startDate: eventLocalDate(startAt), endDate: eventLocalDate(endAt),
          nearTermHorizon: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
          demandRadiusKm: hotel.demand_radius_km,
          category: event.category,
          hasConfirmedDateAndLocation: sources.some((source) => {
            if (source.event_id !== event.id || !isEnabledPrimarySource(source, areaByHotel.get(score.hotel_id)?.enabled_sources ?? [])) return false;
            const evidence = readEventEvidence(source.evidence);
            return Boolean(evidence?.dateText && evidence.locationText);
          }),
          scores: [{ importance, impactBasis: score.impact_basis, distanceKm: score.distance_km, assessment: score.demand_assessment }],
        });
        const claim = claims.find((claim) => claim.event_id === event.id && claim.hotel_id === hotel.id);
        return { id: hotel.id, code: hotelCodes.get(hotel.id)!, importance, impactBasis: score.impact_basis,
          available, announced,
          exportLevel: (choices.find((choice) => choice.event_id === event.id && choice.hotel_id === hotel.id)?.importance as DemandLevel | undefined) ?? null,
          exportedAt: batches.find((batch) => batch.id === claim?.latest_batch_id)?.created_at ?? null,
        };
      }),
    };
  }).filter((event) => includeInactive || (event.status === "active" && eventLocalDate(event.startAt) <= range.end && eventLocalDate(event.endAt) >= range.start));
  return { hotels, events };
}

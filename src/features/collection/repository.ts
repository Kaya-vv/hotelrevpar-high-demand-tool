import { normalizeCandidate } from "@/features/events/normalize";
import { classifyMatch } from "@/features/events/match";
import { scoreHotelEvent } from "@/features/events/score";
import type { ValidationReason } from "@/features/events/types";
import { validateCandidate } from "@/features/events/validate";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

import type { CollectionContext, CollectionRepository, RunCollectionInput } from "./run";
import { sourceChange } from "./source-change";

function window() {
  const start = new Date();
  const end = new Date(start);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function createCollectionRepository(): CollectionRepository {
  const supabase = createAdminClient();

  return {
    async startRun(input: RunCollectionInput) {
      const staleBefore = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { error: staleError } = await supabase
        .from("collection_runs")
        .update({ finished_at: new Date().toISOString(), error_summary: "stale run recovered" })
        .eq("account_id", input.accountId)
        .eq("collection_area_id", input.areaId)
        .is("finished_at", null)
        .lt("started_at", staleBefore);
      if (staleError) throw staleError;

      const { data, error } = await supabase
        .from("collection_runs")
        .insert({ account_id: input.accountId, collection_area_id: input.areaId, trigger: input.trigger })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },

    async loadContext(accountId, areaId) {
      const [areaResult, hotelsResult] = await Promise.all([
        supabase.from("collection_areas").select("*").eq("id", areaId).eq("account_id", accountId).single(),
        supabase.from("hotels").select("*").eq("account_id", accountId),
      ]);
      if (areaResult.error) throw areaResult.error;
      if (hotelsResult.error) throw hotelsResult.error;
      const area = areaResult.data;
      return {
        area: {
          id: area.id,
          accountId: area.account_id,
          name: area.name,
          searchLocation: area.search_location,
          latitude: area.latitude,
          longitude: area.longitude,
          radiusKm: area.radius_km,
          enabledSources: area.enabled_sources,
        },
        hotels: hotelsResult.data.map((hotel) => ({
          id: hotel.id,
          latitude: hotel.latitude,
          longitude: hotel.longitude,
          demandRadiusKm: hotel.demand_radius_km,
          holidayRegion: hotel.holiday_region,
        })),
        window: window(),
      } as CollectionContext;
    },

    async persistCandidate(context, candidate) {
      const normalized = normalizeCandidate(candidate);
      const { data: existingSource, error: sourceError } = await supabase
        .from("event_sources")
        .select("event_id, extracted_start_at, extracted_location")
        .eq("provider", candidate.provider)
        .eq("provider_event_id", candidate.providerEventId)
        .maybeSingle();
      if (sourceError) throw sourceError;

      let eventId: string | null = existingSource?.event_id ?? null;
      let conflict: ValidationReason | null = null;
      let preserveCanonical = false;
      let duplicate = false;

      if (existingSource) {
        const change = sourceChange(
          { extractedStartAt: existingSource.extracted_start_at, extractedLocation: existingSource.extracted_location },
          candidate,
        );
        conflict = change.conflict;
        preserveCanonical = change.preserveCanonical;
      } else {
        const dayStart = `${normalized.localStartDate}T00:00:00Z`;
        const dayEnd = `${normalized.localStartDate}T23:59:59Z`;
        const { data: nearby, error: nearbyError } = await supabase
          .from("events")
          .select("*")
          .gte("start_at", dayStart)
          .lte("start_at", dayEnd);
        if (nearbyError) throw nearbyError;
        const match = classifyMatch(
          normalized,
          nearby.map((event) =>
            normalizeCandidate({
              provider: candidate.provider,
              providerEventId: "",
              sourceUrl: candidate.sourceUrl,
              title: event.title,
              category: event.category,
              venue: event.venue,
              latitude: event.latitude,
              longitude: event.longitude,
              regionScope: event.region_scope,
              startAt: event.start_at,
              endAt: event.end_at,
              sourceState: event.source_state === "predicted" ? "predicted" : "active",
              certainty: event.certainty,
              localRank: null,
              attendance: null,
              venueCapacity: null,
              evidenceText: null,
              primarySourceConfirmed: true,
            }),
          ).map((event, index) => ({ ...event, id: nearby[index].id })),
        );
        if (match.kind === "exact") eventId = match.eventId;
        if (match.kind === "uncertain") {
          duplicate = true;
          conflict = "duplicate_uncertain";
        }
      }

      const eventRow = {
        normalized_identity: normalized.normalizedIdentity,
        title: candidate.title,
        category: candidate.category,
        venue: candidate.venue,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        region_scope: candidate.regionScope,
        start_at: candidate.startAt,
        end_at: candidate.endAt,
        source_state: candidate.sourceState,
        certainty: candidate.certainty,
        updated_at: new Date().toISOString(),
      };
      if (!eventId) {
        const { data, error } = await supabase.from("events").insert(eventRow).select("id").single();
        if (error) throw error;
        eventId = data.id;
      } else if (!preserveCanonical) {
        const { error } = await supabase.from("events").update(eventRow).eq("id", eventId);
        if (error) throw error;
      }

      const { error: evidenceError } = await supabase.from("event_sources").upsert(
        {
          event_id: eventId,
          provider: candidate.provider,
          provider_event_id: candidate.providerEventId,
          source_url: candidate.sourceUrl,
          extracted_title: candidate.title,
          extracted_start_at: candidate.startAt,
          extracted_location: candidate.venue ?? candidate.regionScope,
          evidence_text: candidate.evidenceText,
          source_state: candidate.sourceState,
          certainty: candidate.certainty,
          local_rank: candidate.localRank,
          attendance: candidate.attendance,
          venue_capacity: candidate.venueCapacity,
          primary_source_confirmed: candidate.primarySourceConfirmed,
          checked_at: new Date().toISOString(),
        },
        { onConflict: "provider,provider_event_id" },
      );
      if (evidenceError) throw evidenceError;

      const validation = validateCandidate(
        candidate,
        context.window,
        conflict as Parameters<typeof validateCandidate>[2],
      );
      const { data: existingDecision, error: decisionReadError } = await supabase
        .from("account_events")
        .select("state")
        .eq("account_id", context.area.accountId)
        .eq("event_id", eventId)
        .maybeSingle();
      if (decisionReadError) throw decisionReadError;
      const state = existingDecision?.state === "excluded" && !conflict ? "excluded" : validation.state;
      const { error: decisionError } = await supabase.from("account_events").upsert({
        account_id: context.area.accountId,
        event_id: eventId,
        state,
        review_reason: validation.reason,
      });
      if (decisionError) throw decisionError;

      const { error: areaLinkError } = await supabase.from("account_event_areas").upsert({
        account_id: context.area.accountId,
        event_id: eventId,
        collection_area_id: context.area.id,
      });
      if (areaLinkError) throw areaLinkError;

      for (const hotel of context.hotels) {
        const { data: storedScores, error: scoreReadError } = await supabase
          .from("hotel_event_scores")
          .select("event_id, impact_points, distance_points, stay_pressure_points")
          .eq("hotel_id", hotel.id)
          .neq("event_id", eventId);
        if (scoreReadError) throw scoreReadError;
        const eventIds = storedScores.map((score) => score.event_id);
        const eventResult = eventIds.length
          ? await supabase.from("events").select("id, start_at, end_at").in("id", eventIds)
          : { data: [], error: null };
        if (eventResult.error) throw eventResult.error;
        const eventDates = new Map(eventResult.data.map((event) => [event.id, event]));
        const overlaps = storedScores.flatMap((score) => {
          const event = eventDates.get(score.event_id);
          return event
            ? [{
                startAt: event.start_at,
                endAt: event.end_at,
                preOverlapTotal:
                  score.impact_points + score.distance_points + Math.min(10, score.stay_pressure_points),
              }]
            : [];
        });
        const score = scoreHotelEvent({ candidate, hotel, overlaps });
        const { error: scoreError } = await supabase.from("hotel_event_scores").upsert({
          hotel_id: hotel.id,
          event_id: eventId,
          distance_km: score.distanceKm,
          impact_points: score.impactPoints,
          distance_points: score.distancePoints,
          stay_pressure_points: score.stayPressurePoints,
          total: score.total,
          suggested_importance: score.suggestedImportance,
          impact_basis: score.impactBasis,
        });
        if (scoreError) throw scoreError;
      }

      return { state, duplicate };
    },

    async finishRun(runId, sourceResults, costUsage, errorSummary) {
      const { error } = await supabase
        .from("collection_runs")
        .update({
          finished_at: new Date().toISOString(),
          source_results: sourceResults as Json,
          cost_usage: costUsage,
          error_summary: errorSummary ?? null,
        })
        .eq("id", runId);
      if (error) throw error;
    },
  };
}

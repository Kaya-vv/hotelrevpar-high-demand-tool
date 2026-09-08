import { readEventEvidence } from "@/features/events/evidence";
import { distanceKm } from "@/features/events/distance";
import { normalizeCandidate, eventLocalDate } from "@/features/events/normalize";
import { fetchInBatches } from "@/lib/supabase/fetch-in-batches";
import { classifyMatch } from "@/features/events/match";
import { isPublishableDemand, type DemandLevel } from "@/features/events/importance";
import {
  automatedExclusionReason,
  providerStatusReasons,
  resolvedReviewState,
  reviewFingerprint,
} from "@/features/events/review-fingerprint";
import { scoreHotelEvent } from "@/features/events/score";
import { selectScoreEvidence } from "@/features/events/source-evidence";
import type { EventCandidate, ValidationReason } from "@/features/events/types";
import { validateCandidate } from "@/features/events/validate";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/database.types";

import {
  CLAUDE_ASSESSMENT_VERSION,
} from "./anthropic-batches";
import {
  claudeDiscoveryDue,
  collectionWindow,
  selectClaudeRefreshUrls,
  selectLongRangeSeeds,
  type CollectionContext,
  type CollectionRepository,
  type RunCollectionInput,
  type StoredDemandTriage,
  type StoredEvidenceReview,
} from "./run";
import { shouldRefreshCanonical, sourceChange } from "./source-change";
import { longRangeWindow } from "./sources/claude";

const structuredUpdateProviders = new Set(["rijksoverheid", "openholidays", "ticketmaster", "predicthq", "footballdata"]);
const automatedSourceStates = new Set<EventCandidate["sourceState"]>(["cancelled", "postponed", "removed"]);

function storedCandidate(event: Database["public"]["Tables"]["events"]["Row"], evidence: Database["public"]["Tables"]["event_sources"]["Row"]): EventCandidate {
  return {
    evidence: readEventEvidence(evidence.evidence),
    provider: evidence.provider as EventCandidate["provider"],
    providerEventId: evidence.provider_event_id,
    sourceUrl: evidence.source_url,
    publicSourceUrl: evidence.public_source_url,
    title: event.title, category: event.category, venue: event.venue,
    latitude: event.latitude, longitude: event.longitude, regionScope: event.region_scope,
    startAt: event.start_at, endAt: event.end_at,
    sourceState: evidence.source_state as EventCandidate["sourceState"],
    providerDuplicateOfId: evidence.provider_duplicate_of_id,
    providerDeletedReason: evidence.provider_deleted_reason,
    providerCancelledAt: evidence.provider_cancelled_at,
    providerPostponedAt: evidence.provider_postponed_at,
    certainty: event.certainty, localRank: evidence.local_rank,
    attendance: evidence.attendance, venueCapacity: evidence.venue_capacity,
    aiImpactPoints: evidence.ai_impact_points,
    overnightAudience: evidence.overnight_audience as EventCandidate["overnightAudience"],
    evidenceText: evidence.evidence_text,
    primarySourceConfirmed: evidence.primary_source_confirmed,
  };
}

function publicSourceUrl(candidate: EventCandidate) {
  const value = candidate.publicSourceUrl ?? (candidate.primarySourceConfirmed ? candidate.sourceUrl : null);
  if (!value) return null;
  if (/[\s'"{}\[\]]/.test(value)) return null;
  try {
    const hostname = new URL(value).hostname;
    return hostname === "api.predicthq.com" || hostname === "api.football-data.org" ? null : value;
  } catch {
    return null;
  }
}

export function createCollectionRepository(): CollectionRepository {
  const supabase = createAdminClient();

  return {
    async reuseNearTermEvidence(context) {
      if (!context.area.enabledSources.includes("claude")) return 0;
      const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const { data: links, error: linkError } = await supabase.from("account_event_areas")
        .select("event_id").eq("account_id", context.area.accountId).eq("collection_area_id", context.area.id);
      if (linkError) throw linkError;
      const linked = new Set(links.map((link) => link.event_id));
      let reused = 0;
      // Page through public facts, not another account's scores or inclusion decisions.
      // Exact distance below handles different hotel centres and radii.
      for (let offset = 0; ; offset += 500) {
        const { data: events, error } = await supabase.from("events").select("*")
          .eq("certainty", "confirmed")
          .lte("start_at", `${context.window.end}T23:59:59Z`)
          .gte("end_at", `${context.window.start}T00:00:00Z`)
          .order("id").range(offset, offset + 499);
        if (error) throw error;
        const nearby = events.filter((event) => !linked.has(event.id)
          && event.latitude !== null && event.longitude !== null
          && context.hotels.some((hotel) => distanceKm(hotel.latitude, hotel.longitude, event.latitude!, event.longitude!) <= hotel.demandRadiusKm));
        const sources = await fetchInBatches(nearby.map((event) => event.id), (ids) => supabase.from("event_sources")
          .select("*").eq("provider", "claude").in("event_id", ids));
        // A recorded date/identity conflict is unresolved research, not reusable evidence.
        const conflicts = await fetchInBatches(nearby.map((event) => event.id), (ids) => supabase.from("account_events")
          .select("event_id").eq("state", "needs_review")
          .in("review_reason", ["date_conflict", "changed_date", "changed_venue", "duplicate_uncertain"]).in("event_id", ids));
        for (const event of nearby) {
          if (conflicts.some((row) => row.event_id === event.id)) continue;
          const source = selectScoreEvidence(sources.filter((row) => row.event_id === event.id), ["claude"]);
          if (!source || source.checked_at < cutoff || source.assessment_version < CLAUDE_ASSESSMENT_VERSION) continue;
          if (sources.some((row) => row.event_id === event.id && row.checked_at >= source.checked_at
            && (row.source_state !== "active" || (row.primary_source_confirmed
              && (Date.parse(row.extracted_start_at) !== Date.parse(event.start_at)
                || Date.parse(row.extracted_end_at ?? row.extracted_start_at) !== Date.parse(event.end_at ?? event.start_at)))))) continue;
          if (Date.parse(source.extracted_start_at) !== Date.parse(event.start_at)
            || Date.parse(source.extracted_end_at ?? source.extracted_start_at) !== Date.parse(event.end_at ?? event.start_at)) continue;
          const candidate = storedCandidate(event, source);
          if (validateCandidate(candidate, context.window, null).state !== "active") continue;
          // Insert only: preserve this account's exclusions, reviews and manual decisions.
          const decision = await supabase.from("account_events").upsert({
            account_id: context.area.accountId, event_id: event.id, state: "active",
          }, { onConflict: "account_id,event_id", ignoreDuplicates: true });
          if (decision.error) throw decision.error;
          const link = await supabase.from("account_event_areas").upsert({
            account_id: context.area.accountId, collection_area_id: context.area.id, event_id: event.id,
          });
          if (link.error) throw link.error;
          // Never rewrite the source or advance checked_at merely because it was reused.
          reused += 1;
        }
        if (events.length < 500) break;
      }
      return reused;
    },
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
      const areaResult = await supabase.from("collection_areas").select("*").eq("id", areaId).eq("account_id", accountId).single();
      if (areaResult.error) throw areaResult.error;
      const area = areaResult.data;
      if (!area.hotel_id) throw new Error("Verzamelgebied is niet aan een hotel gekoppeld.");
      const hotelResult = await supabase.from("hotels").select("*").eq("id", area.hotel_id).eq("account_id", accountId).single();
      if (hotelResult.error) throw hotelResult.error;
      const hotel = hotelResult.data;
      const window = collectionWindow();
      const futureWindow = longRangeWindow(window);
      const { data: linkData, error: linkError } = await supabase
        .from("account_event_areas")
        .select("event_id")
        .eq("account_id", accountId)
        .eq("collection_area_id", areaId);
      if (linkError) throw linkError;
      const links = linkData ?? [];
      const claudeSources = links.length
        ? await fetchInBatches(
          links.map((link) => link.event_id),
          (ids) => supabase
            .from("event_sources")
            .select("event_id, source_url, extracted_start_at, extracted_end_at, checked_at, assessment_version")
            .eq("provider", "claude")
            .eq("primary_source_confirmed", true)
            .in("event_id", ids),
        )
        : [];
      const scores = links.length
        ? await fetchInBatches(
          links.map((link) => link.event_id),
          (ids) => supabase
            .from("hotel_event_scores")
            .select("event_id, suggested_importance, importance_override, impact_basis")
            .eq("hotel_id", hotel.id)
            .in("event_id", ids),
        )
        : [];
      const visibleEventIds = new Set(scores.filter((score) =>
        isPublishableDemand(
          (score.importance_override ?? score.suggested_importance) as DemandLevel,
          score.impact_basis,
        )
      ).map((score) => score.event_id));
      const currentAssessmentEventIds = new Set(
        claudeSources
          .filter((source) => source.assessment_version >= CLAUDE_ASSESSMENT_VERSION)
          .map((source) => source.event_id),
      );
      const refreshSources = claudeSources.map((source) => ({
        ...source,
        needs_reassessment:
          visibleEventIds.has(source.event_id) &&
          !currentAssessmentEventIds.has(source.event_id),
      }));
      // Seeds come from every provider, not just Claude: the marathon may have entered the calendar
      // through PredictHQ and still carry an official page the evidence reviewer confirmed.
      const confirmedSources = links.length
        ? await fetchInBatches(
          links.map((link) => link.event_id),
          (ids) => supabase
            .from("event_sources")
            .select("event_id, source_url, public_source_url, extracted_start_at, extracted_end_at, checked_at, ai_impact_points, extracted_location, evidence")
            .eq("primary_source_confirmed", true)
            .in("event_id", ids),
        )
        : [];
      const seedRows = selectLongRangeSeeds(confirmedSources);
      const seedTitles = seedRows.length
        ? await fetchInBatches(seedRows.map((row) => row.eventId), (ids) =>
          supabase.from("events").select("id, title, venue").in("id", ids))
        : [];
      const reassessmentDue = refreshSources.some((source) => source.needs_reassessment);
      // A third of every run's verification budget went to events this area already holds as
      // confirmed. Loading their identity lets discovery skip them and spend the slot on
      // something unknown; refreshing them stays the job of `knownClaudeUrls`.
      const knownEvents = links.length
        ? await fetchInBatches(
          links.map((link) => link.event_id),
          (ids) => supabase
            .from("events")
            .select("title, start_at, end_at")
            .eq("certainty", "confirmed")
            .in("id", ids)
            .lte("start_at", `${futureWindow.end}T23:59:59Z`)
            .gte("end_at", `${window.start}T00:00:00Z`),
        )
        : [];
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
        hotels: [{
          id: hotel.id,
          latitude: hotel.latitude,
          longitude: hotel.longitude,
          demandRadiusKm: hotel.demand_radius_km,
          holidayRegion: hotel.holiday_region,
        }],
        window,
        knownClaudeUrls: selectClaudeRefreshUrls(
          refreshSources,
          window,
          reassessmentDue ? 60 : 8,
        ),
        knownEvents: knownEvents.map((event) => ({
          title: event.title,
          startDate: eventLocalDate(event.start_at),
          endDate: event.end_at ? eventLocalDate(event.end_at) : null,
        })),
        longRangeSeeds: seedRows.flatMap((row) => {
          const storedEvent = seedTitles.find((event) => event.id === row.eventId);
          const title = storedEvent?.title;
          const source = confirmedSources.filter((source) => source.event_id === row.eventId && (source.public_source_url ?? source.source_url) === row.url).sort((a, b) => b.checked_at.localeCompare(a.checked_at))[0];
          const lastEditionStart = source ? eventLocalDate(source.extracted_start_at) : undefined;
          return title ? [{ title, url: row.url, officialPages: [...new Set([row.url, ...confirmedSources.filter((source) => source.event_id === row.eventId).map((source) => source.public_source_url ?? source.source_url)])].filter((url) => /^https?:\/\//i.test(url)).slice(0, 4), lastEditionStart, lastEditionEnd: row.lastEditionEnd, historicalDemandPoints: row.historicalDemandPoints, ...(source?.extracted_location ? { previousLocation: { venue: storedEvent?.venue ?? null, text: source.extracted_location, sourceUrl: row.url, checkedAt: source.checked_at, evidence: readEventEvidence(source.evidence) } } : {}) }] : [];
        }),
        // Retain source history after an edition ends to discover future programmes.
        // These seed agendas only: checking old editions against a future window must not invalidate them.
        claudeAgendaSeedUrls: [...new Set(refreshSources
          .sort((a, b) => a.checked_at.localeCompare(b.checked_at))
          .map((source) => source.source_url))].slice(0, 8),
      } as CollectionContext;
    },

    async loadDemandTriages(context, candidates) {
      if (!candidates.length) return {};
      const rows = await fetchInBatches(candidates.map((candidate) => candidate.providerEventId), (ids) =>
        supabase
          .from("event_candidate_reviews")
          .select("provider_event_id, fingerprint, decision, confidence, demand_level, source_url, evidence_text")
          .eq("collection_area_id", context.area.id)
          .eq("provider", "predicthq")
          .in("provider_event_id", ids),
      );
      return Object.fromEntries(rows.map((row) => [row.provider_event_id, {
        providerEventId: row.provider_event_id,
        fingerprint: row.fingerprint,
        decision: row.decision as StoredDemandTriage["decision"],
        confidence: row.confidence as StoredDemandTriage["confidence"],
        demandLevel: row.demand_level as StoredDemandTriage["demandLevel"],
        evidenceText: row.evidence_text,
      } satisfies StoredDemandTriage]));
    },

    async saveDemandTriages(context, reviews) {
      if (!reviews.length) return;
      const { error } = await supabase.from("event_candidate_reviews").upsert(reviews.map((review) => ({
        collection_area_id: context.area.id,
        provider: "predicthq",
        provider_event_id: review.providerEventId,
        fingerprint: review.fingerprint,
        decision: review.decision,
        confidence: review.confidence,
        demand_level: review.demandLevel,
        source_url: null,
        evidence_text: review.evidenceText,
        checked_at: new Date().toISOString(),
      })));
      if (error) throw error;
    },

    async loadEvidenceReviews(candidates) {
      if (!candidates.length) return {};
      const rows = await fetchInBatches(candidates.map((candidate) => candidate.providerEventId), (ids) =>
        supabase
          .from("event_evidence_cache")
          .select("provider_event_id, fingerprint, decision, confidence, source_url, evidence_text")
          .eq("provider", "predicthq")
          .in("provider_event_id", ids),
      );
      return Object.fromEntries(rows.map((row) => [row.provider_event_id, {
        providerEventId: row.provider_event_id,
        fingerprint: row.fingerprint,
        decision: row.decision as StoredEvidenceReview["decision"],
        confidence: row.confidence as StoredEvidenceReview["confidence"],
        sourceUrl: row.source_url,
        evidenceText: row.evidence_text,
      } satisfies StoredEvidenceReview]));
    },

    async saveEvidenceReviews(reviews) {
      if (!reviews.length) return;
      const { error } = await supabase.from("event_evidence_cache").upsert(reviews.map((review) => ({
        provider: "predicthq",
        provider_event_id: review.providerEventId,
        fingerprint: review.fingerprint,
        decision: review.decision,
        confidence: review.confidence,
        source_url: review.sourceUrl,
        evidence_text: review.evidenceText,
        checked_at: new Date().toISOString(),
      })));
      if (error) throw error;
    },

    async hideCandidates(context, candidates) {
      if (!candidates.length) return;
      const sources = await fetchInBatches(candidates.map((candidate) => candidate.providerEventId), (ids) =>
        supabase.from("event_sources").select("event_id").eq("provider", "predicthq").in("provider_event_id", ids),
      );
      const eventIds = [...new Set(sources.map((source) => source.event_id))];
      for (let index = 0; index < eventIds.length; index += 50) {
        const ids = eventIds.slice(index, index + 50);
        const { error: linkError } = await supabase
          .from("account_event_areas")
          .delete()
          .eq("account_id", context.area.accountId)
          .eq("collection_area_id", context.area.id)
          .in("event_id", ids);
        if (linkError) throw linkError;
        const { error: scoreError } = await supabase
          .from("hotel_event_scores")
          .delete()
          .in("hotel_id", context.hotels.map((hotel) => hotel.id))
          .in("event_id", ids);
        if (scoreError) throw scoreError;
      }
    },

    async invalidateClaudeSources(context, sourceUrls) {
      if (!sourceUrls.length) return;
      const { data: links, error: linkError } = await supabase
        .from("account_event_areas")
        .select("event_id")
        .eq("account_id", context.area.accountId)
        .eq("collection_area_id", context.area.id);
      if (linkError) throw linkError;
      if (!links.length) return;
      const eventIds = links.map((link) => link.event_id);
      for (let index = 0; index < eventIds.length; index += 50) {
        const { error } = await supabase
          .from("event_sources")
          .update({
            primary_source_confirmed: false,
            assessment_version: CLAUDE_ASSESSMENT_VERSION,
            checked_at: new Date().toISOString(),
          })
          .eq("provider", "claude")
          .in("event_id", eventIds.slice(index, index + 50))
          .in("source_url", sourceUrls);
        if (error) throw error;
      }
    },

    async shouldRunClaudeDiscovery(context) {
      const { data, error } = await supabase
        .from("collection_runs")
        .select("finished_at")
        .eq("account_id", context.area.accountId)
        .eq("collection_area_id", context.area.id)
        .not("finished_at", "is", null)
        // A failed distant source must not erase a successful near-term discovery. Legacy runs
        // have no marker, so keep recognising their successful combined state.
        .or("source_results->claude->usage->>nearTermSucceeded.eq.1,and(source_results->claude->usage->>nearTermSucceeded.is.null,source_results->claude->>state.in.(success,zero))")
        .filter("source_results->claude->usage->>nearTermSkipped", "is", null)
        .order("finished_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return claudeDiscoveryDue(data[0]?.finished_at ?? null);
    },

    async quarantineClaudeEditions(context, providerEventIds) {
      const sources = await fetchInBatches(providerEventIds, (ids) => supabase.from("event_sources")
        .select("event_id").eq("provider", "claude").in("provider_event_id", ids));
      const eventIds = [...new Set(sources.map((source) => source.event_id))];
      for (let index = 0; index < eventIds.length; index += 50) {
        const { error } = await supabase.from("account_events").update({ state: "needs_review", review_reason: "date_conflict" })
          .eq("account_id", context.area.accountId).eq("state", "active")
          .in("event_id", eventIds.slice(index, index + 50));
        if (error) throw error;
      }
    },

    async persistCandidate(context, candidate) {
      const { data: existingSource, error: sourceError } = await supabase
        .from("event_sources")
        .select("*, events!inner(*)")
        .eq("provider", candidate.provider)
        .eq("provider_event_id", candidate.providerEventId)
        .maybeSingle();
      if (sourceError) throw sourceError;

      // Background publication may resume after a fresher near-term date/status check.
      // Reuse that evidence while still associating it with a newly eligible hotel.
      const previousEvidence = readEventEvidence(existingSource?.evidence);
      if (candidate.provider === "claude" && existingSource && previousEvidence?.dateText
        && Date.parse(previousEvidence.checkedAt) > (Date.parse(candidate.evidence?.checkedAt ?? "") || 0)) {
        candidate = storedCandidate(existingSource.events, existingSource);
      }
      const normalized = normalizeCandidate(candidate);

      let eventId: string | null = existingSource?.event_id ?? null;
      let conflict: ValidationReason | null = null;
      let preserveCanonical = automatedSourceStates.has(candidate.sourceState);
      let duplicate = false;
      let canonicalStartAt = candidate.startAt;
      let canonicalEndAt = candidate.endAt;
      let reviewTargetEventId: string | null = null;

      if (existingSource) {
        const change = sourceChange(
          { extractedStartAt: existingSource.extracted_start_at, extractedLocation: existingSource.extracted_location },
          candidate,
        );
        conflict = change.conflict;
        preserveCanonical = preserveCanonical || change.preserveCanonical;
        if (
          conflict &&
          (structuredUpdateProviders.has(candidate.provider) ||
            shouldRefreshCanonical(candidate)) &&
          !automatedSourceStates.has(candidate.sourceState)
        ) {
          conflict = null;
          preserveCanonical = false;
        }
      }

      if (!existingSource && candidate.providerDuplicateOfId) {
        const { data: duplicateTarget, error: duplicateTargetError } = await supabase
          .from("event_sources")
          .select("event_id")
          .eq("provider", candidate.provider)
          .eq("provider_event_id", candidate.providerDuplicateOfId)
          .maybeSingle();
        if (duplicateTargetError) throw duplicateTargetError;
        if (duplicateTarget) {
          eventId = duplicateTarget.event_id;
          duplicate = true;
          preserveCanonical = true;
        }
      }

      // Re-run canonical matching for an existing provider row too. Earlier code stopped at the
      // provider ID, so improved title matching could merge new rows but never repair old ones.
      if (!eventId || existingSource) {
        const shiftDay = (days: number) => {
          const date = new Date(`${normalized.localStartDate}T00:00:00Z`);
          date.setUTCDate(date.getUTCDate() + days);
          return date.toISOString().slice(0, 10);
        };
        const dayStart = `${shiftDay(-1)}T00:00:00Z`;
        const dayEnd = `${shiftDay(1)}T23:59:59Z`;
        const { data: nearbyRows, error: nearbyError } = await supabase
          .from("events")
          .select("*")
          .gte("start_at", dayStart)
          .lte("start_at", dayEnd);
        if (nearbyError) throw nearbyError;
        const orderedNearby = nearbyRows.toSorted((left, right) =>
          left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)
        );
        const currentEvent = orderedNearby.find((event) => event.id === existingSource?.event_id);
        const nearby = orderedNearby.filter((event) => event.id !== existingSource?.event_id);
        const confirmedIds = new Set(
          (nearby.length
            ? await fetchInBatches(nearby.map((event) => event.id), (ids) =>
              supabase
                .from("event_sources")
                .select("event_id")
                .eq("source_state", "active")
                .eq("primary_source_confirmed", true)
                .in("event_id", ids),
            )
            : []
          ).map((row) => row.event_id),
        );
        const match = classifyMatch(
          normalized,
          nearby.map((event) => ({
            ...normalizeCandidate({
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
              aiImpactPoints: null,
              evidenceText: null,
              primarySourceConfirmed: confirmedIds.has(event.id),
            }),
            id: event.id,
          })),
        );
        if (match.kind === "exact") {
          const target = nearby.find((event) => event.id === match.eventId);
          const currentIsCanonical = Boolean(
            currentEvent && target &&
            (currentEvent.created_at < target.created_at ||
              (currentEvent.created_at === target.created_at && currentEvent.id < target.id)),
          );
          if (!currentIsCanonical) {
            eventId = match.eventId;
            duplicate = true;
            preserveCanonical = !shouldRefreshCanonical(candidate);
            if (match.extend && target) {
              // Day two of the same programme must widen the stored range, never replace it.
              const mergedEnd = target.end_at ?? target.start_at;
              const candidateEnd = candidate.endAt ?? candidate.startAt;
              canonicalStartAt = target.start_at < canonicalStartAt ? target.start_at : canonicalStartAt;
              canonicalEndAt = mergedEnd > candidateEnd ? mergedEnd : candidateEnd;
            }
          }
        }
        if (!existingSource && match.kind === "uncertain") {
          duplicate = true;
          conflict = "duplicate_uncertain";
          reviewTargetEventId = match.eventId;
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
        start_at: canonicalStartAt,
        end_at: canonicalEndAt,
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

      if (candidate.evidence && existingSource) {
        const previous = readEventEvidence(existingSource.evidence);
        const changed = Date.parse(existingSource.extracted_start_at) !== Date.parse(candidate.startAt) || Date.parse(existingSource.extracted_end_at ?? existingSource.extracted_start_at) !== Date.parse(candidate.endAt) || existingSource.source_state !== candidate.sourceState;
        if (previous) candidate.evidence.history = [...(previous.history ?? []), ...(changed ? [{ checkedAt: previous.checkedAt, startAt: existingSource.extracted_start_at, endAt: existingSource.extracted_end_at ?? existingSource.extracted_start_at, status: existingSource.source_state, dateText: previous.dateText, dateSourceUrl: previous.dateSourceUrl }] : [])];
      }
      const verifiedPublicUrl = publicSourceUrl(candidate);
      const primarySourceConfirmed = candidate.primarySourceConfirmed && Boolean(verifiedPublicUrl);
      const { data: evidence, error: evidenceError } = await supabase.from("event_sources").upsert(
        {
          event_id: eventId,
          provider: candidate.provider,
          provider_event_id: candidate.providerEventId,
          source_url: candidate.sourceUrl,
          public_source_url: verifiedPublicUrl,
          extracted_title: candidate.title,
          extracted_start_at: candidate.startAt,
          extracted_end_at: candidate.endAt,
          extracted_location: candidate.venue ?? candidate.regionScope,
          evidence_text: candidate.evidenceText,
          evidence: candidate.evidence ? JSON.parse(JSON.stringify(candidate.evidence)) as Json : null,
          source_state: candidate.sourceState,
          certainty: candidate.certainty,
          local_rank: candidate.localRank,
          attendance: candidate.attendance,
          venue_capacity: candidate.venueCapacity,
          ai_impact_points: candidate.aiImpactPoints ?? null,
          assessment_version: candidate.assessmentVersion ?? 1,
          overnight_audience: candidate.overnightAudience ?? null,
          primary_source_confirmed: primarySourceConfirmed,
          provider_duplicate_of_id: candidate.providerDuplicateOfId ?? null,
          provider_deleted_reason: candidate.providerDeletedReason ?? null,
          provider_cancelled_at: candidate.providerCancelledAt ?? null,
          provider_postponed_at: candidate.providerPostponedAt ?? null,
          checked_at: new Date().toISOString(),
        },
        { onConflict: "provider,provider_event_id" },
      ).select("id").single();
      if (evidenceError) throw evidenceError;

      const validation = validateCandidate(
        { ...candidate, primarySourceConfirmed },
        ["claude", "openholidays", "rijksoverheid"].includes(candidate.provider)
          ? { start: context.window.start, end: longRangeWindow(context.window).end }
          : context.window,
        conflict as Parameters<typeof validateCandidate>[2],
      );
      const { data: existingDecision, error: decisionReadError } = await supabase
        .from("account_events")
        .select("state, resolved_review_fingerprint, automation_reason")
        .eq("account_id", context.area.accountId)
        .eq("event_id", eventId)
        .maybeSingle();
      if (decisionReadError) throw decisionReadError;
      const fingerprint = validation.state === "needs_review" && validation.reason
        ? reviewFingerprint(candidate, validation.reason, reviewTargetEventId)
        : null;
      let validationState = validation.state;
      let validationReason = validation.reason;
      if (validation.state === "excluded" && validation.reason && providerStatusReasons.has(validation.reason)) {
        const { data: activeEvidence, error: activeEvidenceError } = await supabase
          .from("event_sources")
          .select("id")
          .eq("event_id", eventId)
          .eq("source_state", "active")
          .eq("primary_source_confirmed", true)
          .neq("id", evidence.id)
          .limit(1);
        if (activeEvidenceError) throw activeEvidenceError;
        if (activeEvidence.length) {
          validationState = "active";
          validationReason = null;
        }
      }
      const state = resolvedReviewState({
        validationState,
        existingState: existingDecision?.state,
        existingFingerprint: existingDecision?.resolved_review_fingerprint,
        fingerprint,
        conflict: Boolean(conflict),
        automatedExclusion: Boolean(existingDecision?.automation_reason),
      });
      const existingManualExclusion = existingDecision?.state === "excluded" && !existingDecision.automation_reason;
      const automationReason = automatedExclusionReason(state, validationReason, existingManualExclusion);
      const decision = {
        account_id: context.area.accountId,
        event_id: eventId,
        state,
        review_reason: state === "needs_review" ? validationReason : null,
        review_target_event_id: state === "needs_review" ? reviewTargetEventId : null,
        review_source_id: state === "needs_review" ? evidence.id : null,
        review_fingerprint: fingerprint,
        automation_reason: automationReason,
        ...(!fingerprint ? { resolved_review_fingerprint: null } : {}),
      };
      const { error: decisionError } = await supabase.from("account_events").upsert(decision);
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
          .select("impact_points, distance_points, stay_pressure_points, events!inner(start_at, end_at)")
          .eq("hotel_id", hotel.id)
          .neq("event_id", eventId)
          .lte("events.start_at", candidate.endAt)
          .gte("events.end_at", candidate.startAt);
        if (scoreReadError) throw scoreReadError;
        const overlaps = storedScores.map((score) => ({
          startAt: score.events.start_at,
          endAt: score.events.end_at,
          preOverlapTotal: score.impact_points + score.distance_points + Math.min(10, score.stay_pressure_points),
        }));
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

      return { state, duplicate, eventId };
    },

    async recalculateScores(context) {
      const { data: links, error: linkError } = await supabase
        .from("account_event_areas")
        .select("event_id")
        .eq("account_id", context.area.accountId)
        .eq("collection_area_id", context.area.id);
      if (linkError) throw linkError;
      if (!links.length) return;

      const linkedIds = links.map((link) => link.event_id);
      const decisions = await fetchInBatches(linkedIds, (ids) =>
        supabase.from("account_events").select("event_id").eq("account_id", context.area.accountId).eq("state", "active").in("event_id", ids),
      );
      const activeIds = decisions.map((decision) => decision.event_id);
      if (!activeIds.length) return;
      const [events, sources] = await Promise.all([
        fetchInBatches(activeIds, (ids) => supabase.from("events").select("*").in("id", ids)),
        fetchInBatches(activeIds, (ids) => supabase.from("event_sources").select("*").in("event_id", ids)),
      ]);
      const candidates = events.flatMap((event) => {
        const evidence = selectScoreEvidence(
          sources.filter((source) => source.event_id === event.id),
          context.area.enabledSources,
        );
        if (!evidence) return [];
        return [{
          eventId: event.id,
          candidate: storedCandidate(event, evidence),
        }];
      });
      const supportedIds = new Set(candidates.map(({ eventId }) => eventId));
      const unsupportedIds = activeIds.filter((id) => !supportedIds.has(id));

      const published = new Set<string>();
      const latency = { announcementWithin14Days: 0, announcementMissed14Days: 0, announcementDateUnknown: 0 };
      for (const hotel of context.hotels) {
        for (let index = 0; index < unsupportedIds.length; index += 50) {
          const { error } = await supabase
            .from("hotel_event_scores")
            .delete()
            .eq("hotel_id", hotel.id)
            .in("event_id", unsupportedIds.slice(index, index + 50));
          if (error) throw error;
        }
        const bases = new Map(candidates.map(({ eventId, candidate }) => [
          eventId,
          scoreHotelEvent({ candidate, hotel, overlaps: [] }),
        ]));
        const rows = candidates.map(({ eventId, candidate }) => {
          const overlaps = candidates
            .filter((other) => other.eventId !== eventId)
            .map((other) => ({
              startAt: other.candidate.startAt,
              endAt: other.candidate.endAt,
              preOverlapTotal: bases.get(other.eventId)?.total ?? 0,
            }));
          const score = scoreHotelEvent({ candidate, hotel, overlaps });
          return {
            hotel_id: hotel.id,
            event_id: eventId,
            distance_km: score.distanceKm,
            impact_points: score.impactPoints,
            distance_points: score.distancePoints,
            stay_pressure_points: score.stayPressurePoints,
            total: score.total,
            suggested_importance: score.suggestedImportance,
            impact_basis: score.impactBasis,
          };
        });
        for (let index = 0; index < rows.length; index += 200) {
          const { error } = await supabase.from("hotel_event_scores").upsert(rows.slice(index, index + 200));
          if (error) throw error;
        }
        // Query the persisted score, including preserved account overrides, after recalculation.
        const scores = await fetchInBatches(activeIds, (ids) => supabase.from("hotel_event_scores").select("event_id, suggested_importance, importance_override, impact_basis, first_eligible_at").eq("hotel_id", hotel.id).in("event_id", ids));
        for (const score of scores) {
          const event = events.find((event) => event.id === score.event_id);
          if (event?.certainty === "confirmed" && event.start_at.slice(0, 10) > context.window.end && supportedIds.has(event.id)
            && isPublishableDemand((score.importance_override ?? score.suggested_importance) as DemandLevel, score.impact_basis)) {
            published.add(`${hotel.id}:${event.id}`);
            const firstEligibleAt = score.first_eligible_at ?? new Date().toISOString();
            if (!score.first_eligible_at) {
              const { error } = await supabase.from("hotel_event_scores").update({ first_eligible_at: firstEligibleAt }).eq("hotel_id", hotel.id).eq("event_id", event.id).is("first_eligible_at", null);
              if (error) throw error;
            }
            const announcedAt = candidates.find((candidate) => candidate.eventId === event.id)?.candidate.evidence?.announcedAt;
            if (!announcedAt) latency.announcementDateUnknown++;
            else if ((Date.parse(firstEligibleAt.slice(0, 10)) - Date.parse(announcedAt)) / 86400000 <= 14) latency.announcementWithin14Days++;
            else latency.announcementMissed14Days++;
          }
        }
      }
      return { hotelPublished: published.size, ...latency };
    },

    async recordUsage(runId, source, usage) {
      if (!usage.requestId && !(usage.inputTokens + usage.outputTokens + usage.webSearchRequests + (usage.cacheWriteTokens ?? 0) + (usage.cacheReadTokens ?? 0))) return;
      const { error } = await supabase.from("collection_usage_events").upsert({
        request_id: usage.requestId ?? null,
        market_key: usage.marketKey ?? null,
        horizon: usage.horizon ?? null,
        cache_write_tokens: usage.cacheWriteTokens ?? 0,
        cache_read_tokens: usage.cacheReadTokens ?? 0,
        billing_mode: usage.billingMode ?? null,
        estimated_cost_usd: usage.estimatedCostUsd ?? null,
        collection_run_id: runId,
        source,
        phase: usage.phase,
        model: usage.model,
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        web_search_requests: usage.webSearchRequests,
        web_fetch_requests: usage.webFetchRequests,
      }, { onConflict: "request_id", ignoreDuplicates: true });
      if (error) throw error;
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

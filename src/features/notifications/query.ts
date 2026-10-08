import { trialHorizonEnd } from "@/features/accounts/trial";
import { readEventEvidence } from "@/features/events/evidence";
import {
  demandLabels,
  gradedDemand,
  hotelCalendarVisibility,
} from "@/features/events/importance";
import { eventLocalDate } from "@/features/events/normalize";
import { isEnabledPrimarySource } from "@/features/events/source-evidence";
import { fetchInBatches } from "@/lib/supabase/fetch-in-batches";
import type { AdminClient } from "@/lib/supabase/admin";

export type NotificationEvent = {
  id: string;
  title: string;
  venue: string | null;
  startAt: string;
  endAt: string;
  level: string;
  /** Shown as Medium; exported only when the manager chooses it. */
  announced: boolean;
};

export type NotificationHotel = {
  id: string;
  name: string;
  events: NotificationEvent[];
};

export async function loadVisibleNotificationEvents(
  admin: AdminClient,
  accountId: string,
  hotelId: string,
  now = new Date(),
): Promise<NotificationHotel | null> {
  const [
    { data: hotel, error: hotelError },
    { data: area, error: areaError },
    { data: account, error: accountError },
  ] =
    await Promise.all([
      admin
        .from("hotels")
        .select("id, name, demand_radius_km")
        .eq("account_id", accountId).is("archived_at", null)
        .eq("id", hotelId)
        .maybeSingle(),
      admin
        .from("collection_areas")
        .select("id, enabled_sources")
        .eq("account_id", accountId)
        .eq("hotel_id", hotelId)
        .maybeSingle(),
      admin
        .from("accounts")
        .select("trial_ends_at")
        .eq("id", accountId)
        .single(),
    ]);
  if (hotelError) throw hotelError;
  if (areaError) throw areaError;
  if (accountError) throw accountError;
  if (!hotel || !area) return null;

  const { data: links, error: linkError } = await admin
    .from("account_event_areas")
    .select("event_id")
    .eq("account_id", accountId)
    .eq("collection_area_id", area.id);
  if (linkError) throw linkError;
  const linkedIds = [...new Set(links.map((link) => link.event_id))];
  if (!linkedIds.length) return { id: hotel.id, name: hotel.name, events: [] };

  const decisions = await fetchInBatches(linkedIds, (ids) =>
    admin
      .from("account_events")
      .select(
        "event_id, merged_into_event_id, override_title, override_venue, override_start_at, override_end_at",
      )
      .eq("account_id", accountId)
      .eq("state", "active")
      .in("event_id", ids),
  );
  const eventIds = decisions.map((decision) => decision.event_id);
  if (!eventIds.length) return { id: hotel.id, name: hotel.name, events: [] };

  const [events, sources, scores] = await Promise.all([
    fetchInBatches(eventIds, (ids) =>
      admin
        .from("events")
        .select("id, title, venue, category, start_at, end_at, certainty")
        .in("id", ids),
    ),
    fetchInBatches(eventIds, (ids) =>
      admin
        .from("event_sources")
        .select(
          "event_id, provider, source_state, primary_source_confirmed, public_source_url, extracted_location, evidence",
        )
        .in("event_id", ids),
    ),
    fetchInBatches(eventIds, (ids) =>
      admin
        .from("hotel_event_scores")
        .select(
          "event_id, suggested_importance, importance_override, impact_basis, distance_km, demand_assessment",
        )
        .eq("hotel_id", hotelId)
        .in("event_id", ids),
    ),
  ]);

  const decisionsByEvent = new Map(
    decisions.map((decision) => [decision.event_id, decision]),
  );
  const nearTermHorizon = new Date(now.getTime() + 90 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const start = eventLocalDate(now.toISOString());
  const yearEnd = `${Number(start.slice(0, 4)) + 1}-12-31`;
  // A free trial is never told about an event it cannot see in its calendar.
  const horizonEnd = trialHorizonEnd(account.trial_ends_at, now);
  const end = horizonEnd && horizonEnd < yearEnd ? horizonEnd : yearEnd;

  const visible = events.flatMap((event) => {
    const decision = decisionsByEvent.get(event.id);
    if (!decision) return [];
    const startAt = decision.override_start_at ?? event.start_at;
    const endAt = decision.override_end_at ?? event.end_at;
    if (eventLocalDate(startAt) > end || eventLocalDate(endAt) < start) return [];

    const enabledSources = sources.filter(
      (source) =>
        source.event_id === event.id &&
        isEnabledPrimarySource(source, area.enabled_sources),
    );
    const eventScores = scores
      .filter((score) => score.event_id === event.id)
      .map((score) => ({
        ...gradedDemand(score),
        distanceKm: score.distance_km,
        assessment: score.demand_assessment,
      }));
    const visibility = hotelCalendarVisibility({
      active: !decision.merged_into_event_id,
      confirmed: event.certainty === "confirmed",
      supported: enabledSources.length > 0,
      startDate: eventLocalDate(startAt),
      endDate: eventLocalDate(endAt),
      nearTermHorizon,
      demandRadiusKm: hotel.demand_radius_km,
      category: event.category,
      hasConfirmedDateAndLocation: enabledSources.some((source) => {
        const evidence = readEventEvidence(source.evidence);
        return Boolean(evidence?.dateText && evidence.locationText);
      }),
      scores: eventScores,
    });
    if (!visibility.visible || !visibility.shownLevel) return [];
    return [
      {
        id: event.id,
        title: decision.override_title ?? event.title,
        venue:
          decision.override_venue ??
          event.venue ??
          enabledSources.find((source) => source.extracted_location)
            ?.extracted_location ??
          enabledSources
            .map((source) => readEventEvidence(source.evidence)?.locationText)
            .find(Boolean) ??
          null,
        startAt,
        endAt,
        level: demandLabels[visibility.shownLevel],
        announced: visibility.announced,
      },
    ];
  });

  return {
    id: hotel.id,
    name: hotel.name,
    events: visible.sort(
      (left, right) =>
        left.startAt.localeCompare(right.startAt) ||
        left.title.localeCompare(right.title, "nl"),
    ),
  };
}

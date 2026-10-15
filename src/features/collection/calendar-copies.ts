import { demandLabels, demandLevels } from "@/features/events/importance";
import { classifyMatch } from "@/features/events/match";
import { eventLocalDate, normalizeCandidate } from "@/features/events/normalize";
import { loadVisibleNotificationEvents } from "@/features/notifications/query";
import type { AdminClient } from "@/lib/supabase/admin";
import { fetchInBatches } from "@/lib/supabase/fetch-in-batches";

type CopyEvent = {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  createdAt: string;
  /** Hand-edited for this account: may be kept, never hidden as someone else's copy. */
  manual: boolean;
  note: string | null;
  /** Shown level per hotel, as a rank in `demandLevels`. */
  levels: Map<string, number>;
};

export type CopyGroup = {
  events: CopyEvent[];
  keeperId: string | null;
  /** Why nothing was merged, in the words shown to the owner. */
  skipped: string | null;
};

function dayAfter(date: string) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/**
 * Finds events that one account's calendars show more than once: the same event saved from two
 * websites (three rows for the Amsterdam Marathon, ERA as "64th ... Congress" and "... 2027").
 * New arrivals are matched when they are saved, but rows that slipped in earlier, or whose dates
 * were corrected later, were never compared again. This uses the very rule the search code
 * merges new arrivals with, so concerts on different nights (Oasis 16 and 17 July) stay apart.
 */
export async function findCalendarCopies(admin: AdminClient, accountId: string, now = new Date()) {
  const { data: hotels, error: hotelError } = await admin
    .from("hotels").select("id").eq("account_id", accountId).is("archived_at", null);
  if (hotelError) throw hotelError;

  const shown = new Map<string, { startAt: string; endAt: string; levels: Map<string, number> }>();
  for (const hotel of hotels) {
    const calendar = await loadVisibleNotificationEvents(admin, accountId, hotel.id, now);
    for (const event of calendar?.events ?? []) {
      const rank = demandLevels.findIndex((level) => demandLabels[level] === event.level);
      const entry = shown.get(event.id) ?? { startAt: event.startAt, endAt: event.endAt, levels: new Map() };
      entry.levels.set(hotel.id, rank);
      shown.set(event.id, entry);
    }
  }
  const ids = [...shown.keys()];
  if (ids.length < 2) return [];

  const [rows, decisions, overrides] = await Promise.all([
    fetchInBatches(ids, (batch) => admin.from("events")
      .select("id, title, category, venue, latitude, longitude, region_scope, start_at, end_at, source_state, certainty, created_at")
      .in("id", batch)),
    fetchInBatches(ids, (batch) => admin.from("account_events")
      .select("event_id, override_title, override_venue, override_start_at, override_end_at, decided_by, operator_note")
      .eq("account_id", accountId).in("event_id", batch)),
    fetchInBatches(ids, (batch) => admin.from("hotel_event_scores")
      .select("event_id").in("hotel_id", hotels.map((hotel) => hotel.id))
      .not("importance_override", "is", null).in("event_id", batch)),
  ]);
  const manualIds = new Set([
    ...decisions.filter((decision) => decision.decided_by || decision.override_title || decision.override_venue
      || decision.override_start_at || decision.override_end_at).map((decision) => decision.event_id),
    ...overrides.map((score) => score.event_id),
  ]);
  const notes = new Map(decisions.map((decision) => [decision.event_id, decision.operator_note]));

  const events = rows.map((row) => {
    const calendar = shown.get(row.id)!;
    return {
      event: {
        id: row.id,
        title: row.title,
        startDate: eventLocalDate(calendar.startAt),
        endDate: eventLocalDate(calendar.endAt),
        createdAt: row.created_at,
        manual: manualIds.has(row.id),
        note: notes.get(row.id) ?? null,
        levels: calendar.levels,
      } satisfies CopyEvent,
      // Built exactly as the search code builds stored rows before matching them. Each row gets its
      // own source ID: an empty one on both sides would make every pair an "exact" provider match.
      normalized: {
        ...normalizeCandidate({
          provider: "claude", providerEventId: row.id, sourceUrl: "",
          title: row.title, category: row.category, venue: row.venue,
          latitude: row.latitude, longitude: row.longitude, regionScope: row.region_scope,
          startAt: row.start_at, endAt: row.end_at,
          sourceState: row.source_state === "predicted" ? "predicted" : "active",
          certainty: row.certainty, localRank: null, attendance: null, venueCapacity: null,
          aiImpactPoints: null, evidenceText: null, primarySourceConfirmed: false,
        }),
        id: row.id,
      },
    };
  }).sort((left, right) => left.normalized.localStartDate.localeCompare(right.normalized.localStartDate));

  // Group matches transitively: the Marathon's three rows are one group, not three pairs.
  const group = new Map(events.map(({ event }) => [event.id, event.id]));
  const root = (id: string): string => {
    const parent = group.get(id)!;
    return parent === id ? id : root(parent);
  };
  for (let left = 0; left < events.length; left += 1) {
    for (let right = left + 1; right < events.length; right += 1) {
      const [a, b] = [events[left].normalized, events[right].normalized];
      if (b.localStartDate > dayAfter(a.localEndDate)) break;
      if (classifyMatch(a, [b]).kind === "exact" || classifyMatch(b, [a]).kind === "exact") {
        group.set(root(b.id), root(a.id));
      }
    }
  }
  const members = new Map<string, CopyEvent[]>();
  for (const { event } of events) members.set(root(event.id), [...members.get(root(event.id)) ?? [], event]);

  return [...members.values()].filter((copies) => copies.length > 1).map((copies): CopyGroup => {
    const hotelIds = new Set(copies.flatMap((event) => [...event.levels.keys()]));
    const startDate = copies.map((event) => event.startDate).sort()[0];
    const endDate = copies.map((event) => event.endDate).sort().at(-1)!;
    // The kept row must lose nothing: shown at every hotel, at the highest level, on every day.
    const keepers = copies.filter((event) => event.startDate <= startDate && event.endDate >= endDate
      && [...hotelIds].every((hotelId) => (event.levels.get(hotelId) ?? -1)
        >= Math.max(...copies.map((other) => other.levels.get(hotelId) ?? -1))))
      .sort((left, right) => Number(right.manual) - Number(left.manual) || left.createdAt.localeCompare(right.createdAt));
    const keeper = keepers[0];
    if (!keeper) return { events: copies, keeperId: null, skipped: "geen vermelding heeft alle dagen op het hoogste niveau" };
    if (copies.some((event) => event.manual && event.id !== keeper.id)) {
      return { events: copies, keeperId: null, skipped: "een vermelding is met de hand aangepast" };
    }
    return { events: copies, keeperId: keeper.id, skipped: null };
  });
}

/** Hides every copy behind the row that is kept; all records, scores and history are retained. */
export async function mergeCalendarCopies(admin: AdminClient, accountId: string, now = new Date()) {
  let merged = 0;
  for (const copyGroup of await findCalendarCopies(admin, accountId, now)) {
    const keeper = copyGroup.events.find((event) => event.id === copyGroup.keeperId);
    if (!keeper) continue;
    for (const copy of copyGroup.events.filter((event) => event.id !== keeper.id)) {
      const { data: hidden, error } = await admin.from("account_events")
        .update({
          state: "excluded",
          merged_into_event_id: keeper.id,
          operator_note: [copy.note, `Automatisch samengevoegd met "${keeper.title}": dubbele vermelding.`]
            .filter(Boolean).join("\n"),
          decided_at: now.toISOString(),
        })
        .eq("account_id", accountId).eq("event_id", copy.id)
        .eq("state", "active").is("merged_into_event_id", null)
        .select("event_id");
      if (error) throw error;
      if (!hidden.length) continue;
      merged += 1;
      const { error: itemError } = await admin.from("event_notification_items")
        .update({ suppressed: true })
        .eq("account_id", accountId).eq("event_id", copy.id).is("batch_id", null);
      if (itemError) throw itemError;
    }
  }
  return { merged };
}

import { beforeEach, expect, it, vi } from "vitest";

import type { AdminClient } from "@/lib/supabase/admin";

type Row = Record<string, unknown>;
type Shown = { id: string; title: string; startAt: string; endAt: string; level: string };
const state = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, shown: {} as Record<string, Shown[]> }));
vi.mock("@/features/notifications/query", () => ({
  loadVisibleNotificationEvents: async (_: unknown, __: string, hotelId: string) =>
    ({ id: hotelId, name: hotelId, events: state.shown[hotelId] ?? [] }),
}));

import { findCalendarCopies, mergeCalendarCopies } from "./calendar-copies";

function from(table: string) {
  const filters: ((row: Row) => boolean)[] = [];
  let changes: Row | null = null;
  const query = {
    select: () => query,
    update: (values: Row) => { changes = values; return query; },
    eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
    is: (key: string, value: unknown) => { filters.push((row) => (row[key] ?? null) === value); return query; },
    in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
    not: (key: string) => { filters.push((row) => row[key] != null); return query; },
    range: () => query,
    then: (resolve: (value: unknown) => unknown) => {
      const rows = (state.tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
      if (changes) rows.forEach((row) => Object.assign(row, changes));
      return Promise.resolve({ data: rows, error: null }).then(resolve);
    },
  };
  return query;
}
const admin = { from } as unknown as AdminClient;

// Stored as the search code stores them: one Amsterdam day runs 22:00 UTC to 21:59:59 UTC.
const days = (first: number, last: number) => ({
  start_at: `2027-06-0${first - 1}T22:00:00+00:00`, end_at: `2027-06-0${last}T21:59:59+00:00`,
});
function event(id: string, title: string, range: { start_at: string; end_at: string }, created: string, category = "congress") {
  state.tables.events.push({ id, title, category, venue: "Ahoy", latitude: 51.88, longitude: 4.49, region_scope: null,
    source_state: "active", certainty: "confirmed", created_at: created, ...range });
  state.tables.account_events.push({ account_id: "account", event_id: id, state: "active", merged_into_event_id: null });
}
function show(hotel: string, id: string, level: string) {
  const row = state.tables.events.find((candidate) => candidate.id === id)!;
  (state.shown[hotel] ??= []).push({ id, title: String(row.title), startAt: String(row.start_at), endAt: String(row.end_at), level });
}

beforeEach(() => {
  state.tables = { hotels: [{ id: "hotel", account_id: "account", archived_at: null }], events: [], account_events: [],
    hotel_event_scores: [], event_notification_items: [] };
  state.shown = {};
});

it("hides a second listing of one congress behind the first and keeps both records", async () => {
  event("era", "64th European Renal Association (ERA) Congress", days(3, 6), "2026-09-01");
  event("era-copy", "European Renal Association (ERA) 2027", days(3, 6), "2026-09-10");
  show("hotel", "era", "Hoog");
  show("hotel", "era-copy", "Hoog");
  state.tables.event_notification_items.push({ account_id: "account", event_id: "era-copy", batch_id: null, suppressed: false });

  expect(await mergeCalendarCopies(admin, "account")).toEqual({ merged: 1 });
  const copy = state.tables.account_events.find((row) => row.event_id === "era-copy")!;
  expect(copy).toMatchObject({ state: "excluded", merged_into_event_id: "era" });
  expect(state.tables.account_events.find((row) => row.event_id === "era")).toMatchObject({ state: "active", merged_into_event_id: null });
  expect(state.tables.event_notification_items[0].suppressed).toBe(true);
  expect(await mergeCalendarCopies(admin, "account")).toEqual({ merged: 0 });
});

it("keeps two concert nights apart", async () => {
  event("night-1", "Oasis Live '27", days(3, 3), "2026-09-01", "concert");
  event("night-2", "Oasis Live '27", days(4, 4), "2026-09-01", "concert");
  show("hotel", "night-1", "Hoog");
  show("hotel", "night-2", "Hoog");
  expect(await findCalendarCopies(admin, "account")).toEqual([]);
});

it("keeps the copy with the higher level, and never hides a hand-edited one", async () => {
  event("old", "World Bulk Wine Exhibition", days(3, 4), "2026-09-01");
  event("new", "World Bulk Wine Exhibition 2027", days(3, 4), "2026-09-10");
  show("hotel", "old", "Hoog");
  show("hotel", "new", "Piek");
  expect((await findCalendarCopies(admin, "account"))[0].keeperId).toBe("new");

  state.tables.account_events.find((row) => row.event_id === "new")!.override_venue = "Ahoy Hal 1";
  state.shown.hotel[0].level = "Piek";
  expect((await findCalendarCopies(admin, "account"))[0].keeperId).toBe("new");
});

it("leaves the copies alone when no listing covers every day", async () => {
  event("early", "Dutch Design Week", days(3, 5), "2026-09-01");
  event("late", "Dutch Design Week", days(4, 6), "2026-09-10");
  show("hotel", "early", "Hoog");
  show("hotel", "late", "Hoog");
  const [group] = await findCalendarCopies(admin, "account");
  expect(group.keeperId).toBeNull();
  expect(await mergeCalendarCopies(admin, "account")).toEqual({ merged: 0 });
});

it("does not hide a copy behind a listing another hotel cannot see", async () => {
  state.tables.hotels.push({ id: "second", account_id: "account", archived_at: null });
  event("era", "64th European Renal Association (ERA) Congress", days(3, 6), "2026-09-01");
  event("era-copy", "European Renal Association (ERA) 2027", days(3, 6), "2026-09-10");
  show("hotel", "era", "Hoog");
  show("hotel", "era-copy", "Hoog");
  show("second", "era-copy", "Hoog");
  expect((await findCalendarCopies(admin, "account"))[0].keeperId).toBe("era-copy");
});

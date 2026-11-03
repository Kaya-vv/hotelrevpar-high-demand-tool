import { describe, expect, it } from "vitest";

import type { EventCandidate } from "@/features/events/types";
import { movedClaudeSources, type StoredSource } from "./moved-events";

const today = "2026-11-03";
const page = "https://www.loveland.nl/festival/";

const reported = (overrides: Partial<EventCandidate> = {}): EventCandidate => ({
  provider: "claude", providerEventId: "claude:new", sourceUrl: "https://loveland.nl/festival", title: "Loveland Festival",
  category: "festival", venue: "Sloterpark", latitude: 52.37, longitude: 4.8, regionScope: "Amsterdam",
  startAt: "2027-08-13T12:00:00+02:00", endAt: "2027-08-14T23:00:00+02:00", sourceState: "active", certainty: "confirmed",
  localRank: null, attendance: null, venueCapacity: null, evidenceText: null, primarySourceConfirmed: true, ...overrides,
});

const stored = (overrides: Partial<StoredSource> = {}): StoredSource => ({
  eventId: "event-1", provider: "claude", providerEventId: "claude:old", sourceUrl: page, title: "Loveland Festival",
  startAt: "2027-07-16T12:00:00+02:00", ...overrides,
});

const moved = (candidates: EventCandidate[], sources: StoredSource[], refreshed = [page]) =>
  movedClaudeSources(candidates, refreshed, sources, today);

describe("movedClaudeSources", () => {
  it("hands a re-dated event its stored source, so it keeps its ID", () => {
    expect(moved([reported()], [stored()])).toEqual([
      { eventId: "event-1", fromProviderEventId: "claude:old", toProviderEventId: "claude:new" },
    ]);
  });

  // A title search answers only for the date it searched; the stored date can still be on the page.
  it("needs the stored page itself re-read, not a title search", () => {
    expect(moved([reported()], [stored()], [])).toEqual([]);
  });

  // TCS Amsterdam Marathon 2027 was found on 7 October 2026, ten days before the 2026 race,
  // on the same website and under the same title. The 2026 race must not move to 2027.
  it("keeps a next year's edition separate", () => {
    expect(moved([reported({ startAt: "2028-07-14T12:00:00+02:00" })], [stored()])).toEqual([]);
  });

  it("leaves a date the page still lists in place", () => {
    const stillListed = reported({ providerEventId: "claude:old", startAt: "2027-07-16T12:00:00+02:00" });
    expect(moved([reported(), stillListed], [stored()])).toEqual([]);
  });

  it("leaves a date confirmed again on another page in place", () => {
    const organiser = stored({ providerEventId: "claude:organiser", sourceUrl: "https://organiser.example/" });
    expect(moved([reported(), reported({ providerEventId: "claude:organiser", sourceUrl: "https://organiser.example/" })], [stored(), organiser])).toEqual([]);
  });

  it("does not guess between several upcoming dates of one title", () => {
    expect(moved([reported()], [stored(), stored({ eventId: "event-2", providerEventId: "claude:other", startAt: "2027-09-10T12:00:00+02:00" })])).toEqual([]);
  });

  it("does not move a show night: concert pages list a rolling set of dates", () => {
    expect(moved([reported({ category: "concert" })], [stored()])).toEqual([]);
  });

  it("does not move an event that already took place", () => {
    expect(moved([reported({ startAt: "2026-12-01T12:00:00+01:00" })], [stored({ startAt: "2026-11-01T12:00:00+01:00" })])).toEqual([]);
  });

  it("leaves an event with a stable-ID provider to that provider", () => {
    expect(moved([reported()], [stored(), stored({ provider: "ticketmaster", providerEventId: "tm-1" })])).toEqual([]);
  });

  it("leaves a one-day shift to the normal duplicate match", () => {
    expect(moved([reported({ startAt: "2027-07-17T12:00:00+02:00" })], [stored()])).toEqual([]);
  });
});

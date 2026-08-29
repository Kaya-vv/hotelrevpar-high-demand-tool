import { describe, expect, it } from "vitest";

import type { EventCandidate } from "./types";
import { demandReviewFingerprint, prefilterHotelDemand } from "./hotel-demand";

const candidate: EventCandidate = {
  provider: "predicthq",
  providerEventId: "phq-1",
  sourceUrl: "https://api.predicthq.com/v1/events/phq-1/",
  title: "Major trade fair",
  category: "expos",
  venue: null,
  latitude: 51.44,
  longitude: 5.48,
  regionScope: null,
  startAt: "2027-10-10T08:00:00Z",
  endAt: "2027-10-12T18:00:00Z",
  sourceState: "active",
  certainty: "confirmed",
  localRank: 75,
  attendance: 8000,
  venueCapacity: null,
  evidenceText: null,
  primarySourceConfirmed: false,
};

describe("hotel demand prefilter", () => {
  it("sends plausible active events to cheap metadata triage", () => {
    expect(prefilterHotelDemand(candidate)).toEqual({
      action: "triage",
      reason: "plausible_demand",
    });
  });

  it("excludes weak predictions and low-attendance sports before Claude", () => {
    expect(
      prefilterHotelDemand({
        ...candidate,
        sourceState: "predicted",
        category: "sports",
        attendance: 2_000,
        localRank: 60,
      }).action
    ).toBe("exclude");
    expect(
      prefilterHotelDemand({
        ...candidate,
        category: "sports",
        attendance: 1800,
        localRank: 82,
      }).action
    ).toBe("exclude");
    expect(
      prefilterHotelDemand({
        ...candidate,
        category: "sports",
        attendance: 8000,
        localRank: 94,
      }).action
    ).toBe("exclude");
    expect(
      prefilterHotelDemand({
        ...candidate,
        category: "sports",
        attendance: 10_000,
        localRank: 94,
      }).action
    ).toBe("triage");
  });

  it("triages only strong predictions and keeps Champions League dates provisional", () => {
    expect(
      prefilterHotelDemand({
        ...candidate,
        sourceState: "predicted",
        category: "concerts",
        attendance: 20_000,
      }).action
    ).toBe("triage");
    expect(
      prefilterHotelDemand({
        ...candidate,
        sourceState: "predicted",
        title: "Potentiële Champions League wedstrijddag",
        category: "sports",
        attendance: null,
        localRank: null,
      }).action
    ).toBe("provisional");
  });

  it("keeps multi-day business events but removes small one-day entertainment", () => {
    expect(
      prefilterHotelDemand({
        ...candidate,
        category: "conferences",
        attendance: 1500,
        localRank: 65,
      }).action
    ).toBe("triage");
    expect(
      prefilterHotelDemand({
        ...candidate,
        category: "concerts",
        endAt: candidate.startAt,
        attendance: 4000,
        localRank: 79,
      }).action
    ).toBe("exclude");
  });

  it("persists provider removals so automation can update the canonical event", () => {
    expect(
      prefilterHotelDemand({ ...candidate, sourceState: "cancelled" }).action
    ).toBe("persist");
    expect(
      prefilterHotelDemand({ ...candidate, sourceState: "postponed" }).action
    ).toBe("persist");
  });

  it("invalidates a cached review when material event data changes", () => {
    const original = demandReviewFingerprint(candidate);
    expect(demandReviewFingerprint(candidate)).toBe(original);
    expect(
      demandReviewFingerprint({ ...candidate, startAt: "2027-10-11T08:00:00Z" })
    ).not.toBe(original);
  });
});

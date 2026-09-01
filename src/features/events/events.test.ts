import { describe, expect, it } from "vitest";

import { distanceKm } from "./distance";
import { isPublishableDemand } from "./importance";
import { classifyMatch } from "./match";
import { normalizeCandidate, normalizeText } from "./normalize";
import { impact, importance, scoreHotelEvent } from "./score";
import type { EventCandidate } from "./types";
import { validateCandidate } from "./validate";

const candidate: EventCandidate = {
  provider: "ticketmaster",
  providerEventId: "tm-1",
  sourceUrl: "https://example.com/event",
  title: "Dutch Design Week",
  category: "festival",
  venue: "Klokgebouw",
  latitude: 51.448,
  longitude: 5.458,
  regionScope: null,
  startAt: "2027-10-16T10:00:00+02:00",
  endAt: "2027-10-24T22:00:00+02:00",
  sourceState: "active",
  certainty: "confirmed",
  localRank: null,
  attendance: null,
  venueCapacity: null,
  evidenceText: null,
  primarySourceConfirmed: true,
};

describe("event domain", () => {
  it("publishes Medium demand with evidence and hides Low or default demand", () => {
    expect(isPublishableDemand("Medium", "attendance")).toBe(true);
    expect(isPublishableDemand("High", "ai_assessment")).toBe(true);
    expect(isPublishableDemand("Medium", "default")).toBe(false);
    expect(isPublishableDemand("Low", "attendance")).toBe(false);
  });

  it("normalizes accents and punctuation", () => {
    expect(normalizeText("  Café-déjà! ")).toBe("cafe deja");
  });

  it("matches provider IDs and normalized identities exactly", () => {
    const normalized = normalizeCandidate(candidate);
    expect(
      classifyMatch(normalized, [{ ...normalized, id: "event-1" }])
    ).toEqual({ kind: "exact", eventId: "event-1" });
    expect(
      classifyMatch({ ...normalized, providerEventId: "new-id" }, [
        { ...normalized, providerEventId: "old-id", id: "event-2" },
      ])
    ).toEqual({ kind: "exact", eventId: "event-2" });
  });

  it("marks a similar same-day title as uncertain", () => {
    const normalized = normalizeCandidate(candidate);
    const changed = normalizeCandidate({
      ...candidate,
      providerEventId: "other",
      title: "Dutch Design Festival",
      venue: "Strijp-S",
    });
    expect(
      classifyMatch(changed, [{ ...normalized, id: "event-1" }]).kind
    ).toBe("uncertain");
  });

  it("automatically merges reordered titles and harmless year suffixes", () => {
    const normalized = normalizeCandidate(candidate);
    const sameEvent = normalizeCandidate({
      ...candidate,
      provider: "claude",
      providerEventId: "other",
      title: "Dutch Design Week (DDW) 2027",
      venue: "Diverse locaties in Eindhoven",
      latitude: null,
      longitude: null,
    });
    expect(
      classifyMatch(sameEvent, [{ ...normalized, id: "event-1" }])
    ).toEqual({
      kind: "exact",
      eventId: "event-1",
    });
  });

  it("requires fetched primary evidence for Claude", () => {
    const result = validateCandidate(
      { ...candidate, provider: "claude", primarySourceConfirmed: false },
      { start: "2027-01-01", end: "2027-12-31" },
      null
    );
    expect(result).toMatchObject({
      state: "excluded",
      reason: "missing_primary_evidence",
    });
  });

  it("does not match the same title in a different city", () => {
    const normalized = normalizeCandidate(candidate);
    const remote = normalizeCandidate({
      ...candidate,
      providerEventId: "other",
      venue: "RAI Amsterdam",
      latitude: 52.3676,
      longitude: 4.9041,
    });
    expect(classifyMatch(remote, [{ ...normalized, id: "event-1" }])).toEqual({
      kind: "new",
      eventId: null,
    });
  });

  it("keeps a complete predicted structured event active", () => {
    const result = validateCandidate(
      { ...candidate, sourceState: "predicted", certainty: "provisional" },
      { start: "2027-01-01", end: "2027-12-31" },
      null
    );
    expect(result).toEqual({
      state: "active",
      reason: null,
      certainty: "provisional",
    });
  });

  it.each(["cancelled", "postponed", "removed"] as const)(
    "automatically excludes a %s provider record",
    (sourceState) => {
      expect(
        validateCandidate(
          { ...candidate, sourceState },
          { start: "2027-01-01", end: "2027-12-31" },
          null
        )
      ).toMatchObject({
        state: "excluded",
        reason: sourceState,
      });
    }
  );

  it("keeps unverified PredictHQ suggestions only when they are provisional", () => {
    const result = validateCandidate(
      {
        ...candidate,
        provider: "predicthq",
        primarySourceConfirmed: false,
        certainty: "provisional",
      },
      { start: "2027-01-01", end: "2027-12-31" },
      null
    );
    expect(result).toEqual({
      state: "active",
      reason: null,
      certainty: "provisional",
    });
  });

  it.each([
    [
      {
        localRank: 100,
        attendance: null,
        venueCapacity: null,
        category: "festival",
      },
      { points: 60, basis: "local_rank" },
    ],
    [
      {
        localRank: null,
        attendance: 15000,
        venueCapacity: null,
        category: "festival",
      },
      { points: 60, basis: "attendance" },
    ],
  ])("maps impact evidence", (input, expected) => {
    expect(impact(input)).toEqual(expected);
  });

  it("keeps routine football below Peak while allowing marquee fixtures", () => {
    const regular = scoreHotelEvent({
      candidate: {
        ...candidate,
        title: "PSV vs Heerenveen",
        category: "sports",
        localRank: 95,
        latitude: 51.44,
        longitude: 5.48,
      },
      hotel: {
        latitude: 51.44,
        longitude: 5.48,
        demandRadiusKm: 25,
        holidayRegion: "south",
      },
      overlaps: [
        {
          startAt: candidate.startAt,
          endAt: candidate.endAt,
          preOverlapTotal: 50,
        },
      ],
    });
    const marquee = scoreHotelEvent({
      candidate: {
        ...candidate,
        title: "PSV vs Feyenoord",
        category: "sports",
        localRank: 95,
        latitude: 51.44,
        longitude: 5.48,
      },
      hotel: {
        latitude: 51.44,
        longitude: 5.48,
        demandRadiusKm: 25,
        holidayRegion: "south",
      },
      overlaps: [
        {
          startAt: candidate.startAt,
          endAt: candidate.endAt,
          preOverlapTotal: 50,
        },
      ],
    });
    expect(regular.suggestedImportance).toBe("High");
    expect(marquee.suggestedImportance).toBe("Peak");
  });

  it("uses Claude impact evidence when structured metrics are absent", () => {
    expect(
      impact({
        localRank: null,
        attendance: null,
        venueCapacity: null,
        aiImpactPoints: 45,
        category: "festival",
      })
    ).toEqual({ points: 45, basis: "ai_assessment" });
  });

  it("returns zero distance points at the radius edge", () => {
    const hotel = { latitude: 51.44, longitude: 5.48 };
    const edgeLatitude = hotel.latitude + 25 / 111.195;
    const actualDistance = distanceKm(
      hotel.latitude,
      hotel.longitude,
      edgeLatitude,
      hotel.longitude
    );
    const score = scoreHotelEvent({
      candidate: {
        ...candidate,
        latitude: edgeLatitude,
        longitude: hotel.longitude,
      },
      hotel: {
        ...hotel,
        demandRadiusKm: actualDistance,
        holidayRegion: "south",
      },
      overlaps: [],
    });
    expect(score.distancePoints).toBe(0);
  });

  it("gives an eligible regional school holiday full distance points", () => {
    const score = scoreHotelEvent({
      candidate: {
        ...candidate,
        category: "school_holiday",
        latitude: null,
        longitude: null,
        regionScope: "south",
      },
      hotel: {
        latitude: 51.44,
        longitude: 5.48,
        demandRadiusKm: 25,
        holidayRegion: "south",
      },
      overlaps: [],
    });
    expect(score.distancePoints).toBe(25);
  });

  it.each([
    [39, "Low"],
    [40, "Medium"],
    [69, "Medium"],
    [70, "High"],
    [84, "High"],
    [85, "Peak"],
    [100, "Peak"],
  ])("maps total %i to %s", (total, label) =>
    expect(importance(total)).toBe(label)
  );
});

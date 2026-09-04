import { describe, expect, it } from "vitest";

import { distanceKm } from "./distance";
import {
  isPublishableDemand,
  publishableDemandLevels,
  publishableReviewEventIds,
} from "./importance";
import { classifyMatch } from "./match";
import { normalizeCandidate, normalizeText } from "./normalize";
import { impact, importance, scoreHotelEvent } from "./score";
import { isEnabledPrimarySource } from "./source-evidence";
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
  it("publishes only High and Peak demand with evidence", () => {
    expect(publishableDemandLevels).toEqual(["High", "Peak"]);
    expect(isPublishableDemand("Medium", "attendance")).toBe(false);
    expect(isPublishableDemand("High", "ai_assessment")).toBe(true);
    expect(isPublishableDemand("Peak", "attendance")).toBe(true);
    expect(isPublishableDemand("High", "default")).toBe(false);
    expect(isPublishableDemand("Low", "attendance")).toBe(false);
  });

  it("reviews only events that could be published", () => {
    const decisions = [
      { event_id: "medium", state: "needs_review" },
      { event_id: "high", state: "needs_review" },
      { event_id: "default", state: "needs_review" },
      { event_id: "active", state: "active" },
    ];
    const score = (event_id: string, suggested_importance: string, impact_basis = "ai_assessment") => ({
      event_id,
      suggested_importance,
      importance_override: null,
      impact_basis,
    });

    expect(
      [...publishableReviewEventIds(decisions, [
        score("medium", "Medium"),
        score("high", "High"),
        score("default", "Peak", "default"),
        score("active", "Peak"),
      ])],
    ).toEqual(["high"]);
  });

  it("requires an enabled active primary source with a public URL", () => {
    const source = {
      provider: "claude",
      source_state: "active",
      primary_source_confirmed: true,
      public_source_url: "https://organizer.example/event",
    };
    expect(isEnabledPrimarySource(source, ["claude"])).toBe(true);
    expect(isEnabledPrimarySource(source, ["predicthq"])).toBe(false);
    expect(
      isEnabledPrimarySource({ ...source, public_source_url: null }, ["claude"]),
    ).toBe(false);
  });

  it("normalizes accents and punctuation", () => {
    expect(normalizeText("  Café-déjà! ")).toBe("cafe deja");
  });

  it("gives one event the same identity whether its start is Dutch local or UTC", () => {
    const dutchLocal = normalizeCandidate({ ...candidate, startAt: "2027-10-17T00:00:00+02:00" });
    const storedUtc = normalizeCandidate({
      ...candidate,
      providerEventId: "tm-2",
      startAt: "2027-10-16T22:00:00Z",
    });
    expect(dutchLocal.localStartDate).toBe("2027-10-17");
    expect(storedUtc.localStartDate).toBe("2027-10-17");
    expect(classifyMatch(storedUtc, [{ ...dutchLocal, id: "event-1" }])).toEqual({
      kind: "exact",
      eventId: "event-1",
    });
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

  it("merges a confirmed candidate into an unverified stub instead of asking for review", () => {
    const stub = normalizeCandidate({
      ...candidate,
      provider: "predicthq",
      providerEventId: "phq-stub",
      title: "Dutch Design Festival",
      venue: "Strijp-S",
      primarySourceConfirmed: false,
    });
    const confirmed = normalizeCandidate({
      ...candidate,
      provider: "claude",
      providerEventId: "claude-1",
      primarySourceConfirmed: true,
    });
    expect(classifyMatch(confirmed, [{ ...stub, id: "stub-1" }])).toEqual({
      kind: "exact",
      eventId: "stub-1",
    });
    expect(
      classifyMatch({ ...confirmed, primarySourceConfirmed: false }, [{ ...stub, id: "stub-1" }]).kind,
    ).toBe("uncertain");
  });

  it("merges the second day of a programme a venue agenda lists per day", () => {
    // Klokgebouw lists Revolution Calling as /revolution-calling-20-11 and /-21-11.
    const dayOne = normalizeCandidate({
      ...candidate,
      providerEventId: "rc-20",
      title: "Revolution Calling",
      venue: "Klokgebouw",
      startAt: "2026-11-20T19:00:00+01:00",
      endAt: "2026-11-20T23:59:00+01:00",
    });
    const dayTwo = normalizeCandidate({
      ...candidate,
      providerEventId: "rc-21",
      title: "Revolution Calling",
      venue: "Klokgebouw",
      startAt: "2026-11-21T19:00:00+01:00",
      endAt: "2026-11-21T23:59:00+01:00",
    });
    expect(classifyMatch(dayTwo, [{ ...dayOne, id: "rc-1" }])).toEqual({
      kind: "exact",
      eventId: "rc-1",
      extend: true,
    });

    const nextMonth = normalizeCandidate({
      ...dayTwo,
      providerEventId: "rc-dec",
      startAt: "2026-12-20T19:00:00+01:00",
      endAt: "2026-12-20T23:59:00+01:00",
    });
    expect(classifyMatch(nextMonth, [{ ...dayOne, id: "rc-1" }]).kind).toBe("new");
  });

  it("gives one festival the same identity however the venue is worded", () => {
    // The four stored Dutch Design Week rows, all created by one run on 28 August.
    const phrasings = [
      { venue: "Diverse locaties, Eindhoven centrum", latitude: 51.4416, longitude: 5.4697 },
      { venue: "Diverse locaties in Eindhoven (o.a. Strijp-S)", latitude: 51.4416, longitude: 5.4697 },
      { venue: "Strijp-S en 100+ locaties in Eindhoven", latitude: 51.4362, longitude: 5.4589 },
      { venue: "Klokgebouw / Eindhoven", latitude: 51.4485, longitude: 5.4623 },
    ].map((place, index) =>
      normalizeCandidate({ ...candidate, providerEventId: `ddw-${index}`, title: "Dutch Design Week 2026", ...place }),
    );

    expect(new Set(phrasings.map((p) => p.normalizedIdentity)).size).toBe(1);

    // The surviving cold-start duplicate differed only by the year in the title.
    const withoutYear = normalizeCandidate({
      ...candidate,
      providerEventId: "ddw-noyear",
      title: "Dutch Design Week",
      venue: "Klokgebouw",
      latitude: 51.4487,
      longitude: 5.4578,
    });
    expect(withoutYear.normalizedIdentity).toBe(phrasings[0].normalizedIdentity);
    expect(classifyMatch(phrasings[3], [{ ...phrasings[0], id: "ddw-1" }])).toEqual({
      kind: "exact",
      eventId: "ddw-1",
    });

    // A touring show with the same name in another city stays its own event.
    const amsterdam = normalizeCandidate({
      ...candidate,
      providerEventId: "ddw-ams",
      title: "Dutch Design Week 2026",
      venue: "Westergas",
      latitude: 52.3861,
      longitude: 4.8721,
    });
    expect(amsterdam.normalizedIdentity).not.toBe(phrasings[0].normalizedIdentity);
    expect(classifyMatch(amsterdam, [{ ...phrasings[0], id: "ddw-1" }]).kind).toBe("new");
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

  it("keeps routine football below High while allowing marquee fixtures", () => {
    const hotel = {
      latitude: 51.44,
      longitude: 5.48,
      demandRadiusKm: 25,
      holidayRegion: "south",
    };
    const routine = {
      ...candidate,
      title: "PSV vs Heerenveen",
      category: "sports",
      localRank: 95,
      latitude: 51.44,
      longitude: 5.48,
    };
    const regular = scoreHotelEvent({
      candidate: routine,
      hotel,
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
      hotel,
      overlaps: [
        {
          startAt: candidate.startAt,
          endAt: candidate.endAt,
          preOverlapTotal: 50,
        },
      ],
    });
    expect(regular.total).toBe(69);
    expect(regular.suggestedImportance).toBe("Medium");
    expect(marquee.suggestedImportance).toBe("Peak");

    const european = scoreHotelEvent({
      candidate: {
        ...routine,
        title: "PSV - Club Brugge",
        regionScope: "international",
      },
      hotel,
      overlaps: [],
    });
    expect(european.suggestedImportance).toBe("High");
  });

  it("does not treat a Dutch all-day placeholder as multi-day or late", () => {
    const score = scoreHotelEvent({
      candidate: {
        ...candidate,
        aiImpactPoints: 45,
        startAt: "2026-11-14T23:00:00Z",
        endAt: "2026-11-15T22:59:59Z",
        latitude: 51.44,
        longitude: 5.48,
      },
      hotel: {
        latitude: 51.44,
        longitude: 5.48,
        demandRadiusKm: 25,
        holidayRegion: "south",
      },
      overlaps: [],
    });

    expect(score.stayPressurePoints).toBe(0);
    expect(score.total).toBe(69);
    expect(score.suggestedImportance).toBe("Medium");

    const utcPlaceholder = scoreHotelEvent({
      candidate: {
        ...candidate,
        aiImpactPoints: 45,
        startAt: "2026-11-20T00:00:00Z",
        endAt: "2026-11-20T23:59:00Z",
        latitude: 51.44,
        longitude: 5.48,
      },
      hotel: {
        latitude: 51.44,
        longitude: 5.48,
        demandRadiusKm: 25,
        holidayRegion: "south",
      },
      overlaps: [],
    });
    expect(utcPlaceholder.stayPressurePoints).toBe(0);

    const multiDayPlaceholder = scoreHotelEvent({
      candidate: {
        ...candidate,
        aiImpactPoints: 45,
        startAt: "2026-11-20T00:00:00Z",
        endAt: "2026-11-22T23:59:00Z",
        latitude: 51.44,
        longitude: 5.48,
      },
      hotel: {
        latitude: 51.44,
        longitude: 5.48,
        demandRadiusKm: 25,
        holidayRegion: "south",
      },
      overlaps: [],
    });
    expect(multiDayPlaceholder.stayPressurePoints).toBe(0);
  });

  it("keeps a single-evening local event below High without an overnight signal", () => {
    const hotel = {
      latitude: 51.44,
      longitude: 5.48,
      demandRadiusKm: 25,
      holidayRegion: "south" as const,
    };
    const clubNight = {
      ...candidate,
      title: "Fuego",
      category: "Muziekevenement / Nightlife",
      aiImpactPoints: 45,
      latitude: 51.44,
      longitude: 5.48,
      regionScope: null,
      startAt: "2027-09-19T22:00:00+02:00",
      endAt: "2027-09-20T04:00:00+02:00",
    };
    expect(scoreHotelEvent({ candidate: clubNight, hotel, overlaps: [] }).suggestedImportance)
      .toBe("Medium");

    expect(scoreHotelEvent({
      candidate: { ...clubNight, attendance: 8_000 },
      hotel,
      overlaps: [],
    }).suggestedImportance).toBe("High");

    expect(scoreHotelEvent({
      candidate: { ...clubNight, regionScope: "internationaal" },
      hotel,
      overlaps: [],
    }).suggestedImportance).toBe("High");
  });

  it("keeps real multi-day and stated late-end bonuses", () => {
    const hotel = {
      latitude: 51.44,
      longitude: 5.48,
      demandRadiusKm: 25,
      holidayRegion: "south",
    };
    const multiDay = scoreHotelEvent({
      candidate: {
        ...candidate,
        aiImpactPoints: 35,
        startAt: "2026-10-17T10:00:00+02:00",
        endAt: "2026-10-18T17:00:00+02:00",
        latitude: 51.44,
        longitude: 5.48,
      },
      hotel,
      overlaps: [],
    });
    const late = scoreHotelEvent({
      candidate: {
        ...candidate,
        aiImpactPoints: 35,
        startAt: "2026-10-17T18:00:00+02:00",
        endAt: "2026-10-17T23:00:00+02:00",
        latitude: 51.44,
        longitude: 5.48,
      },
      hotel,
      overlaps: [],
    });

    expect(multiDay.stayPressurePoints).toBe(6);
    expect(late.stayPressurePoints).toBe(4);
  });

  it("lets a stated overnight audience overrule the multi-day proxy", () => {
    const hotel = {
      latitude: 51.44,
      longitude: 5.48,
      demandRadiusKm: 25,
      holidayRegion: "south" as const,
    };
    // A two-day daytime market draws the same day-trippers twice.
    const dayMarket = {
      ...candidate,
      title: "Maker Days",
      aiImpactPoints: 45,
      latitude: 51.44,
      longitude: 5.48,
      regionScope: "national",
      startAt: "2026-09-12T09:00:00+02:00",
      endAt: "2026-09-13T16:00:00+02:00",
    };

    expect(
      scoreHotelEvent({ candidate: dayMarket, hotel, overlaps: [] })
        .suggestedImportance
    ).toBe("High");
    expect(
      scoreHotelEvent({
        candidate: { ...dayMarket, overnightAudience: "regional" },
        hotel,
        overlaps: [],
      }).suggestedImportance
    ).toBe("Medium");
    expect(
      scoreHotelEvent({
        candidate: { ...dayMarket, overnightAudience: "national" },
        hotel,
        overlaps: [],
      }).suggestedImportance
    ).toBe("High");
  });

  it("rewards a programme that runs past midnight", () => {
    const hotel = {
      latitude: 51.44,
      longitude: 5.48,
      demandRadiusKm: 25,
      holidayRegion: "south" as const,
    };
    const lateNight = {
      ...candidate,
      title: "URBN indoor festival",
      aiImpactPoints: 45,
      latitude: 51.44,
      longitude: 5.48,
      overnightAudience: "national" as const,
      startAt: "2026-09-26T20:00:00+02:00",
      endAt: "2026-09-27T02:00:00+02:00",
    };
    const score = scoreHotelEvent({ candidate: lateNight, hotel, overlaps: [] });

    expect(score.stayPressurePoints).toBe(4);
    expect(score.suggestedImportance).toBe("High");
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

  it("uses Claude hotel-demand evidence ahead of provider popularity", () => {
    expect(
      impact({
        localRank: 100,
        attendance: 20_000,
        venueCapacity: 35_000,
        aiImpactPoints: 35,
        category: "expos",
      })
    ).toEqual({ points: 35, basis: "ai_assessment" });
  });

  it("scores a marquee fixture on the competition rule without attendance data", () => {
    expect(
      impact({
        localRank: null,
        attendance: null,
        venueCapacity: null,
        category: "sports",
        title: "PSV - Club Brugge (Champions League)",
      })
    ).toEqual({ points: 60, basis: "competition_rule" });
    expect(
      impact({
        localRank: null,
        attendance: null,
        venueCapacity: null,
        category: "sports",
        title: "PSV - Heracles",
      })
    ).toEqual({ points: 20, basis: "default" });
    expect(isPublishableDemand("Peak", "competition_rule")).toBe(true);
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

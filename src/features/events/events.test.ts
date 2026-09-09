import { describe, expect, it } from "vitest";

import {
  isPublishableDemand,
  publishableDemandLevels,
  publishableReviewEventIds,
} from "./importance";
import { classifyMatch } from "./match";
import { normalizeCandidate, normalizeText } from "./normalize";
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
  it("keeps consecutive concerts and separately timed performances distinct", () => {
    const first = normalizeCandidate({ ...candidate, category: "concerts", title: "Tour show", startAt: "2027-04-20T18:00:00+02:00", endAt: "2027-04-20T20:00:00+02:00" });
    for (const startAt of ["2027-04-21T18:00:00+02:00", "2027-04-20T21:00:00+02:00"]) {
      const next = normalizeCandidate({ ...candidate, providerEventId: "next", category: "concerts", title: "Tour show", startAt, endAt: startAt });
      expect(classifyMatch(next, [{ ...first, id: "first" }])).toEqual({ kind: "new", eventId: null });
    }
  });

  it("uses supported aliases only with the same date and host location", () => {
    const first = normalizeCandidate({ ...candidate, title: "Arts and Design Week" });
    const alias = normalizeCandidate({ ...candidate, providerEventId: "alias", title: "ADW", evidence: { dateText: "Official dated edition", locationText: "Official host location", hostCity: "Eindhoven", locationScope: "citywide", continuous: true, majorCompetition: false, demand: [], aliases: ["Arts and Design Week"], dateSourceUrl: candidate.sourceUrl!, checkedAt: "2026-09-07" } });
    expect(classifyMatch(alias, [{ ...first, id: "first" }]).kind).toBe("exact");
    expect(classifyMatch({ ...alias, latitude: 53.2 }, [{ ...first, id: "first" }]).kind).toBe("new");
  });

  it("publishes only High and Peak demand with evidence", () => {
    expect(publishableDemandLevels).toEqual(["High", "Peak"]);
    expect(isPublishableDemand("Medium", "attendance")).toBe(false);
    expect(isPublishableDemand("High", "demand_rule")).toBe(true);
    expect(isPublishableDemand("Peak", "demand_rule")).toBe(true);
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
    const score = (event_id: string, suggested_importance: string, impact_basis = "demand_rule") => ({
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

  it("treats editions that differ only by a place word as one event", () => {
    // "DigiMarCon Amsterdam 2026", "DigiMarCon Europe 2026" and "DigiMarCon Netherlands 2026"
    // ran on one day at the Johan Cruijff ArenA and became three rows, each published at High.
    const dutch = normalizeCandidate({
      ...candidate,
      providerEventId: "dm-nl",
      title: "DigiMarCon Netherlands 2026",
    });
    const europe = normalizeCandidate({
      ...candidate,
      providerEventId: "dm-eu",
      title: "DigiMarCon Europe 2026",
    });
    expect(classifyMatch(europe, [{ ...dutch, id: "dm-1" }])).toEqual({
      kind: "exact",
      eventId: "dm-1",
    });
  });

  it("keeps two events apart when only a place word is shared", () => {
    // Stripping the city must not make different events identical. Both are real Amsterdam
    // candidates whose titles collapse to two tokens once "Amsterdam" is removed.
    const swim = normalizeCandidate({
      ...candidate,
      providerEventId: "swim",
      title: "Amsterdam City Swim",
    });
    const walk = normalizeCandidate({
      ...candidate,
      providerEventId: "walk",
      title: "Amsterdam City Walk",
    });
    expect(classifyMatch(walk, [{ ...swim, id: "swim-1" }]).kind).not.toBe("exact");
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

});

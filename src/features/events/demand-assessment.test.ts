import { describe, expect, it } from "vitest";
import { assessHotelDemand, hasHotelDemand } from "./demand-assessment";
import { scoreHotelEvent } from "./score";
import { isAnnouncedLongRange, isPublishableDemand } from "./importance";
import { verifyEventEvidence, type EventEvidence } from "./evidence";
import type { EventCandidate } from "./types";

const hotel = { latitude: 51.44, longitude: 5.48, demandRadiusKm: 25, holidayRegion: null };
const base: EventCandidate = { provider: "claude", providerEventId: "test", sourceUrl: "https://organizer.example/event",
  title: "Event", category: "conference", venue: "Venue", latitude: 51.44, longitude: 5.48, regionScope: null,
  startAt: "2027-01-01T10:00:00Z", endAt: "2027-01-03T17:00:00Z", sourceState: "active", certainty: "confirmed",
  localRank: 100, attendance: null, venueCapacity: 50000, aiImpactPoints: 60, evidenceText: null, primarySourceConfirmed: true };
const evidence = (kind?: EventEvidence["demand"][number]["kind"], text = "Hotel room blocks are available for congress delegates."): EventEvidence => ({
  dateText: "1-3 January 2027", locationText: "Venue in Eindhoven", hostCity: "Eindhoven", locationScope: "venue", continuous: true,
  majorCompetition: false, checkedAt: "2026-09-09", dateSourceUrl: base.sourceUrl,
  demand: kind ? [{ kind, text, sourceUrl: base.sourceUrl, scope: "edition", year: 2027, comparable: true }] : [],
});

describe("hotel demand evidence upgrades and contradicts the proxy score", () => {
  it.each(["ticketmaster", "claude", "predicthq"] as const)("never claims demand evidence from popularity, capacity, duration or overlap (%s)", provider => {
    const candidate = { ...base, provider, evidence: evidence() };
    const score = scoreHotelEvent({ candidate, hotel, overlaps: [{ startAt: base.startAt, endAt: base.endAt, preOverlapTotal: 90 }] });
    // Capacity, duration and a neighbouring event are proxies. They may carry a grade, but they
    // must never be reported as quoted hotel-demand evidence.
    expect(score.assessment).toMatchObject({ relevance: "unresolved", magnitude: null });
    expect(score.impactBasis).not.toBe("demand_rule");
  });
  it("includes a small residential congress without manufacturing High demand", () => {
    const result = assessHotelDemand({ ...base, evidence: evidence("hotel_stay") }, hotel);
    expect(result).toMatchObject({ relevance: "supported", magnitude: null });
    expect(hasHotelDemand(result)).toBe(true);
  });
  it("includes a single concert with travelling fans, but not an international artist or tribute name", () => {
    const concert = { ...base, title: "Candlelight: Coldplay & Ed Sheeran", category: "concerts", endAt: base.startAt };
    expect(hasHotelDemand(assessHotelDemand({ ...concert, evidence: evidence("travelling_audience", "Fans travel from abroad for this concert.") }, hotel))).toBe(true);
    expect(hasHotelDemand(assessHotelDemand({ ...concert, evidence: { ...evidence(), demand: [{ text: "International artists perform for local visitors.", sourceUrl: base.sourceUrl, comparable: true, scope: "edition", year: 2027 }] } }, hotel))).toBe(false);
  });
  it("does not turn camping, an ordinary open day or a museum season into hotel demand", () => {
    for (const category of ["festival", "open_day", "museum"]) {
      expect(hasHotelDemand(assessHotelDemand({ ...base, category, evidence: evidence("camping", "Visitors can stay in tents at the festival camping.") }, hotel))).toBe(false);
    }
  });
  it("uses geography for scope and never lets a neighbouring event manufacture demand evidence", () => {
    const candidate = { ...base, latitude: 51.45, evidence: evidence("hotel_stay") };
    const first = scoreHotelEvent({ candidate, hotel, overlaps: [] });
    const second = scoreHotelEvent({ candidate, hotel, overlaps: [{ startAt: base.startAt, endAt: base.endAt, preOverlapTotal: 90 }] });
    expect(second.assessment).toEqual(first.assessment);
    expect(hasHotelDemand(assessHotelDemand(candidate, { ...hotel, demandRadiusKm: 0.01 }))).toBe(false);
  });
  it.each(["cancelled", "postponed", "removed"] as const)("preserves %s exclusion despite strong demand", sourceState => {
    expect(hasHotelDemand(assessHotelDemand({ ...base, sourceState, evidence: evidence("hotel_stay") }, hotel))).toBe(false);
  });
  it("announces an assessed edition beyond the horizon and grades it inside the horizon", () => {
    const assessment = assessHotelDemand({ ...base, evidence: evidence("hotel_stay") }, hotel);
    const band = (startDate: string) => isAnnouncedLongRange({ startDate, endDate: startDate, nearTermHorizon: "2026-12-08",
      demandRadiusKm: 25, category: "conference", hasConfirmedDateAndLocation: true,
      scores: [{ importance: "Low", impactBasis: "default", distanceKm: 1, assessment }] });
    // Beyond the horizon a grade cannot be earned yet, so supported demand is announced without one.
    expect(band("2026-12-09")).toBe(true);
    expect(band("2027-12-01")).toBe(true);
    // Inside the horizon the grade decides. The band must not duplicate a gradeable event.
    expect(band("2026-09-10")).toBe(false);
    expect(band("2026-12-08")).toBe(false);
  });
  it("never announces a long-range event on a proxy grade alone", () => {
    // The regression this replaces: any `ai_assessment` basis was announced regardless of score,
    // so a one-night tribute act the model itself graded 35 appeared unlevelled a year out while
    // the identical event inside 90 days stayed hidden. 45 such events across eight hotels.
    const band = (input: Partial<Parameters<typeof isAnnouncedLongRange>[0]> & { days?: number }) => {
      const startDate = "2027-06-01";
      const endDate = `2027-06-0${input.days ?? 1}`;
      return isAnnouncedLongRange({ startDate, endDate, nearTermHorizon: "2026-12-08",
        demandRadiusKm: 25, category: "conference", hasConfirmedDateAndLocation: true,
        scores: [{ importance: "Medium", impactBasis: "ai_assessment", distanceKm: 1 }], ...input });
    };
    expect(band({})).toBe(false);
    // The destination rule still stands on its own: three confirmed days a year ahead.
    expect(band({ days: 3 })).toBe(true);
    expect(band({ days: 3, hasConfirmedDateAndLocation: false })).toBe(false);
    // A concert series is extracted as one multi-day span; duration is not a stay for it.
    expect(band({ days: 3, category: "Concert" })).toBe(false);
    expect(band({ days: 3, category: "Music Festival" })).toBe(true);
    // Real hotel-demand evidence still announces a single day.
    const assessment = assessHotelDemand({ ...base, evidence: evidence("hotel_stay") }, hotel);
    expect(band({ scores: [{ importance: "Medium", impactBasis: "ai_assessment", distanceKm: 1, assessment }] })).toBe(true);
    // Outside the radius nothing is announced, however it was graded.
    expect(band({ scores: [{ importance: "Medium", impactBasis: "ai_assessment", distanceKm: 99, assessment }] })).toBe(false);
  });
  it("rejects invented quotes and non-comparable historical evidence before scoring", () => {
    const facts = evidence("hotel_stay");
    const verified = verifyEventEvidence(facts, base.sourceUrl, [{ url: base.sourceUrl, text: `${facts.dateText}\n${facts.locationText}` }], "2026-09-09");
    expect(verified?.demand).toEqual([]);
    expect(hasHotelDemand(assessHotelDemand({ ...base, evidence: verified }, hotel))).toBe(false);
    facts.demand[0].comparable = false;
    expect(hasHotelDemand(assessHotelDemand({ ...base, evidence: facts }, hotel))).toBe(false);
  });
  it("publishes an evidenced grade however it was reached, and never an unevidenced one", () => {
    expect(isPublishableDemand("High", "demand_rule")).toBe(true);
    // The regression this replaces: requiring `demand_rule` hid every event graded from an
    // evidenced proxy, which emptied all eight production calendars at once.
    expect(isPublishableDemand("High", "ai_assessment")).toBe(true);
    expect(isPublishableDemand("High", "venue_capacity")).toBe(true);
    expect(isPublishableDemand("High", "default")).toBe(false);
    expect(isPublishableDemand("Medium", "demand_rule")).toBe(false);
  });
  it("admits the independently researched André Rieu hotel package even for a daytime single concert", () => {
    // Official travel operator, reviewed 9 September 2026. Test isolates duration from geography.
    const facts = evidence("hotel_stay", "inchecken in het hotel enkel mogelijk NA AFLOOP van het concert!");
    facts.demand[0].sourceUrl = "https://valk.andrerieu.com/reis_onderdeel/arrangementen_mecc_matinee?category=HOTEL";
    const result = assessHotelDemand({ ...base, title: "Kerst met André", category: "concerts",
      startAt: "2026-12-11T15:00:00+01:00", endAt: "2026-12-11T18:00:00+01:00", evidence: facts }, hotel);
    expect(result).toMatchObject({ relevance: "supported", magnitude: null });
  });
  it.each([
    ["Visitors from 52 countries attend the festival.", 52, "people", "whole_event", false],
    ["The venue offers 2000 seats for visitors.", 2000, "people", "whole_event", false],
    ["The number of visitors was 15000.", 15000, "people", "whole_event", true],
    ["5000 visitors per day attend the festival.", 5000, "people", "per_day", true],
    ["1000 hotel rooms per night are booked for delegates.", 1000, "hotel_rooms", "per_night", true],
  ] as const)("preserves quantity units in %s", (text, value, unit, period, valid) => {
    const facts = evidence("hotel_stay", text);
    facts.demand[0].quantity = { value, unit, period };
    const verified = verifyEventEvidence(facts, base.sourceUrl, [{ url: base.sourceUrl, text }], "2026-09-09")!;
    expect(Boolean(verified.demand[0].quantity)).toBe(valid);
  });
  it("never promotes a large local audience and reserves Peak for current nightly hotel volume", () => {
    const facts = evidence("local_audience", "20000 visitors per day come from the local neighbourhood.");
    facts.demand[0].quantity = { value: 20000, unit: "people", period: "per_day" };
    expect(assessHotelDemand({ ...base, evidence: facts }, hotel).magnitude).toBeNull();
    facts.demand[0] = { ...facts.demand[0], kind: "hotel_stay", text: "1000 hotel rooms per night are booked for delegates.", quantity: { value: 1000, unit: "hotel_rooms", period: "per_night" } };
    expect(assessHotelDemand({ ...base, evidence: facts }, hotel).magnitude).toBe("Peak");
    facts.demand[0] = { ...facts.demand[0], scope: "historical", year: 2025, applicability: "Comparable previous congress at the same venue." };
    expect(assessHotelDemand({ ...base, evidence: facts }, hotel).magnitude).not.toBe("Peak");
  });
});

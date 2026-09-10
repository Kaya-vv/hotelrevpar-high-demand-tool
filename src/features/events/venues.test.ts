import { describe, expect, it } from "vitest";

import { impact } from "./score";
import { isAncillaryListing, knownVenueCapacity } from "./venues";

describe("venue capacity", () => {
  it("reads the arena through the city and stadium suffixes its feeds add", () => {
    for (const venue of [
      "Ziggo Dome",
      "Ziggo Dome, Amsterdam",
      "ziggo dome",
    ]) expect(knownVenueCapacity(venue)).toBe(17_000);
    expect(knownVenueCapacity("Johan Cruijff ArenA")).toBe(55_865);
    expect(knownVenueCapacity("Johan Cruijff ArenA Stadium, Apollolaan 138, Amsterdam")).toBe(55_865);
    expect(knownVenueCapacity("Olympisch Stadion Amsterdam")).toBeNull();
  });

  it("never lends the arena's crowd to the hospitality room beside it", () => {
    // Each of these is a real production venue string sharing the arena's address.
    for (const room of [
      "Ziggo Dome Club",
      "Wine & Dine - Ziggo Dome",
      "Vinyl Room - Ziggo Dome",
      "AFAS Live Loge",
      "AFAS Live Sky Lounge",
      "Ahoy Parking",
    ]) expect(knownVenueCapacity(room)).toBeNull();
  });

  it("recognises add-on listings without touching the show they belong to", () => {
    for (const title of [
      "J. Cole | Venue Premium Packages",
      "Tyla | Premium Seats",
      "Deep Purple - Splat! World Tour 2026 | VIP Package",
      "Westlife | Comfort Seats",
      "Bryson Tiller | Wine & Dine (TICKET NOT INCLUDED)",
      "Parking permit Khalid",
      "K_Parking Permit De Mega Sint Show 2026",
      "Parkeerkaart DI-RECT - BUS",
    ]) expect(isAncillaryListing(title, "Ziggo Dome")).toBe(true);
    for (const title of [
      "Jungle at Ziggo Dome",
      "Diljit Dosanjh - Aura World Tour",
      "2026 LE SSERAFIM TOUR 'PUREFLOW' in Amsterdam",
      "Pussylounge",
    ]) expect(isAncillaryListing(title, "Ziggo Dome")).toBe(false);
  });
});

describe("impact basis", () => {
  const base = { localRank: null, attendance: null, venueCapacity: null, category: "concert" };

  it("raises a model grade that scored an arena show below the publish threshold", () => {
    // Production, 2026-09-10: every Ziggo Dome show was graded 45, reaching 63 of the 70 needed.
    expect(impact({ ...base, aiImpactPoints: 45, title: "Jungle at Ziggo Dome", venue: "Ziggo Dome" }))
      .toEqual({ points: 60, basis: "venue_capacity" });
  });

  it("never lets a missing crowd figure lower a stated grade", () => {
    expect(impact({ ...base, aiImpactPoints: 60, venue: null }))
      .toEqual({ points: 60, basis: "ai_assessment" });
    // AFAS Live holds 6,000, which is worth less than the grade the model already gave.
    expect(impact({ ...base, aiImpactPoints: 60, title: "Weezer", venue: "AFAS Live" }))
      .toEqual({ points: 60, basis: "ai_assessment" });
  });

  it("leaves an add-on listing at the arena on its own merits", () => {
    expect(impact({ ...base, title: "Deep Purple | VIP Package", venue: "Ziggo Dome" }))
      .toEqual({ points: 20, basis: "default" });
  });

  it("leaves a stadium congress and a league fixture on the grade they already had", () => {
    // Production: `DigiMarCon Amsterdam` sits in the ArenA's business centre, not its 55,865 seats.
    expect(impact({ ...base, category: "conference", aiImpactPoints: 45, title: "DigiMarCon Amsterdam 2026", venue: "Johan Cruijff ArenA" }))
      .toEqual({ points: 45, basis: "ai_assessment" });
    // A fixture's crowd is local support, which the scorer's sports policy already discounts.
    for (const category of ["sport", "Football match", "Voetbal (Eredivisie)"])
      expect(impact({ ...base, category, title: "Ajax - Fortuna Sittard", venue: "Johan Cruijff ArenA" }))
        .toEqual({ points: 20, basis: "default" });
  });

  it("still reads a stadium's crowd for a concert that fills it", () => {
    expect(impact({ ...base, category: "music", title: "Stadium tour night", venue: "De Kuip" }))
      .toEqual({ points: 60, basis: "venue_capacity" });
  });
});

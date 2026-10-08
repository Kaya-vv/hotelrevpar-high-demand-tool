import { describe, expect, it } from "vitest";

import { gradedDemand, hotelCalendarVisibility } from "./importance";

const base = {
  active: true,
  confirmed: true,
  supported: true,
  startDate: "2027-10-10",
  endDate: "2027-10-12",
  nearTermHorizon: "2026-12-14",
  demandRadiusKm: 25,
  category: "festival",
  hasConfirmedDateAndLocation: true,
  scores: [
    {
      importance: "Medium" as const,
      impactBasis: "default",
      distanceKm: 4,
    },
  ],
};

const hidden = { visible: false, announced: false, shownLevel: null };

function manual(level: "Low" | "Medium" | "High" | "Peak" | null) {
  const score = gradedDemand({
    suggested_importance: "Medium",
    importance_override: level,
    impact_basis: "ai_assessment",
  });
  return hotelCalendarVisibility({ ...base, scores: [{ ...score, distanceKm: 4 }] });
}

describe("hotel calendar visibility", () => {
  it("publishes a supported High event with its shown level", () => {
    expect(hotelCalendarVisibility({
      ...base,
      scores: [{ importance: "High", impactBasis: "demand_rule", distanceKm: 4 }],
    })).toEqual({ visible: true, announced: false, shownLevel: "High" });
  });

  it("shows an announced event as Medium with and without the Laag toggle", () => {
    expect(hotelCalendarVisibility(base)).toEqual({
      visible: true,
      announced: true,
      shownLevel: "Medium",
    });
    expect(hotelCalendarVisibility({ ...base, includeLow: true })).toEqual({
      visible: true,
      announced: true,
      shownLevel: "Medium",
    });
  });

  it("hides a non-announced automatic Medium by default and shows it as Laag with the toggle", () => {
    const input = {
      ...base,
      startDate: "2026-10-01",
      endDate: "2026-10-02",
      scores: [{ importance: "Medium" as const, impactBasis: "ai_assessment", distanceKm: 4 }],
    };
    expect(hotelCalendarVisibility(input)).toEqual({
      visible: false,
      announced: false,
      shownLevel: "Low",
    });
    expect(hotelCalendarVisibility({ ...input, includeLow: true })).toEqual({
      visible: true,
      announced: false,
      shownLevel: "Low",
    });
  });

  it("keeps a default-basis score hidden even with the Laag toggle", () => {
    expect(hotelCalendarVisibility({
      ...base,
      includeLow: true,
      startDate: "2026-10-01",
      endDate: "2026-10-02",
    })).toEqual(hidden);
  });

  it("shows a hand-set Medium as Medium", () => {
    expect(manual("Medium")).toEqual({
      visible: true,
      announced: true,
      shownLevel: "Medium",
    });
  });

  it("hides a hand-set Low by default and exposes it as Laag only under the toggle", () => {
    expect(manual("Low")).toEqual({
      visible: false,
      announced: false,
      shownLevel: "Low",
    });
    const score = gradedDemand({
      suggested_importance: "Medium",
      importance_override: "Low",
      impact_basis: "ai_assessment",
    });
    expect(hotelCalendarVisibility({
      ...base,
      includeLow: true,
      scores: [{ ...score, distanceKm: 4 }],
    })).toEqual({ visible: true, announced: false, shownLevel: "Low" });
  });

  it("keeps hand-set High and Peak automatically publishable", () => {
    expect(manual("High")).toEqual({ visible: true, announced: false, shownLevel: "High" });
    expect(manual("Peak")).toEqual({ visible: true, announced: false, shownLevel: "Peak" });
  });

  it("announces a confirmed multi-day event inside 90 days only up to 14 days long", () => {
    const near = (endDate: string) => hotelCalendarVisibility({
      ...base,
      startDate: "2026-11-06",
      endDate,
    });
    expect(near("2026-11-14")).toEqual({ visible: true, announced: true, shownLevel: "Medium" });
    expect(near("2026-11-19")).toEqual({ visible: true, announced: true, shownLevel: "Medium" });
    expect(near("2026-11-20")).toEqual(hidden);
    expect(hotelCalendarVisibility({
      ...base,
      startDate: "2027-10-10",
      endDate: "2028-02-14",
    })).toEqual({ visible: true, announced: true, shownLevel: "Medium" });
  });

  it("publishes a hand-set grade when the automatic scorer had no basis", () => {
    const score = gradedDemand({
      suggested_importance: "Medium",
      importance_override: "High",
      impact_basis: "default",
    });
    expect(hotelCalendarVisibility({ ...base, scores: [{ ...score, distanceKm: 4 }] }))
      .toEqual({ visible: true, announced: false, shownLevel: "High" });
  });

  it.each([
    { active: false },
    { confirmed: false },
    { supported: false },
  ])("keeps events outside the common publication gates hidden: %j", (change) => {
    expect(hotelCalendarVisibility({ ...base, ...change })).toEqual(hidden);
  });
});

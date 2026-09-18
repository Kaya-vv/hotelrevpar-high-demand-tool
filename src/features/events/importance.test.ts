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

describe("hotel calendar visibility", () => {
  it("publishes a supported High event", () => {
    expect(
      hotelCalendarVisibility({
        ...base,
        scores: [{ importance: "High", impactBasis: "demand_rule", distanceKm: 4 }],
      }),
    ).toEqual({ visible: true, announced: false });
  });

  it("publishes a confirmed long-range destination as announced", () => {
    expect(hotelCalendarVisibility(base)).toEqual({ visible: true, announced: true });
  });

  it("shows Medium only for the calendar view that asks for it", () => {
    const graded = gradedDemand({
      suggested_importance: "Medium",
      importance_override: null,
      impact_basis: "ai_assessment",
    });
    const scores = [{ ...graded, distanceKm: 4 }];
    // Default: the export, the notifications and the normal calendar keep High and Peak.
    expect(hotelCalendarVisibility({ ...base, scores })).toEqual({ visible: true, announced: true });
    expect(hotelCalendarVisibility({ ...base, scores, startDate: "2026-10-01", endDate: "2026-10-02" }))
      .toEqual({ visible: false, announced: false });
    // With the toggle on, the same near-term event shows with its Medium grade.
    expect(hotelCalendarVisibility({ ...base, scores, includeMedium: true, startDate: "2026-10-01", endDate: "2026-10-02" }))
      .toEqual({ visible: true, announced: false });
    // An event the scorer knew nothing about stays out either way.
    expect(hotelCalendarVisibility({ ...base, includeMedium: true, startDate: "2026-10-01", endDate: "2026-10-02",
      scores: [{ importance: "Medium", impactBasis: "default", distanceKm: 4 }] }))
      .toEqual({ visible: false, announced: false });
  });

  it("lets a hand-set level decide a long-range announcement", () => {
    // The stored row the calendar's "Handmatige inschatting" writes, with nothing but a
    // model guess behind the automatic grade.
    const row = {
      suggested_importance: "Medium",
      importance_override: null as string | null,
      impact_basis: "ai_assessment",
    };
    const withLevel = (level: string | null) => {
      const score = { ...gradedDemand({ ...row, importance_override: level }), distanceKm: 4 };
      return hotelCalendarVisibility({ ...base, scores: [score] });
    };
    expect(withLevel(null)).toEqual({ visible: true, announced: true });
    // Hoog and Piek put the event in the calendar with that grade.
    expect(withLevel("High")).toEqual({ visible: true, announced: false });
    expect(withLevel("Peak")).toEqual({ visible: true, announced: false });
    // Laag and Verhoogd take it out instead of leaving the announcement untouched.
    expect(withLevel("Low")).toEqual({ visible: false, announced: false });
    expect(withLevel("Medium")).toEqual({ visible: false, announced: false });
  });

  it("publishes a hand-set grade the automatic scorer had no basis for", () => {
    const graded = gradedDemand({
      suggested_importance: "Medium",
      importance_override: "High",
      impact_basis: "default",
    });
    expect(graded.importance).toBe("High");
    expect(hotelCalendarVisibility({ ...base, scores: [{ ...graded, distanceKm: 4 }] }))
      .toEqual({ visible: true, announced: false });
  });

  it.each([
    { active: false },
    { confirmed: false },
    { supported: false },
  ])("keeps events outside the common publication gates hidden: %j", (change) => {
    expect(hotelCalendarVisibility({ ...base, ...change }).visible).toBe(false);
  });
});

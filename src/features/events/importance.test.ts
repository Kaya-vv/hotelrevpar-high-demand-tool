import { describe, expect, it } from "vitest";

import { hotelCalendarVisibility } from "./importance";

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

  it.each([
    { active: false },
    { confirmed: false },
    { supported: false },
  ])("keeps events outside the common publication gates hidden: %j", (change) => {
    expect(hotelCalendarVisibility({ ...base, ...change }).visible).toBe(false);
  });
});

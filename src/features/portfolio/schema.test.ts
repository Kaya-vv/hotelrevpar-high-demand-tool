import { describe, expect, it } from "vitest";

import { collectionAreaInput, hotelInput } from "./schema";

describe("portfolio input", () => {
  it("accepts an adjustable hotel radius and holiday region", () => {
    expect(
      hotelInput.parse({
        name: "MATCH",
        revcontrolCode: "MATCH",
        address: "Eindhoven",
        latitude: 51.44,
        longitude: 5.48,
        demandRadiusKm: 25,
        holidayRegion: "south",
      }).demandRadiusKm,
    ).toBe(25);
  });

  it("rejects an area without a source", () => {
    expect(() =>
      collectionAreaInput.parse({
        name: "Eindhoven",
        latitude: 51.44,
        longitude: 5.48,
        radiusKm: 30,
        enabledSources: [],
      }),
    ).toThrow();
  });
});

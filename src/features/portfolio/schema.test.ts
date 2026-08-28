import { describe, expect, it } from "vitest";

import { hotelInput } from "./schema";

describe("portfolio input", () => {
  it("accepts an address, adjustable radius, holiday region, and sources without coordinates", () => {
    const parsed = hotelInput.parse({
        name: "MATCH",
        revcontrolCode: "MATCH",
        address: "Vestdijk 47, 5611CA Eindhoven",
        demandRadiusKm: 25,
        holidayRegion: "south",
        enabledSources: ["ticketmaster", "claude"],
      });

    expect(parsed).toMatchObject({ demandRadiusKm: 25, enabledSources: ["ticketmaster", "claude"] });
    expect(parsed).not.toHaveProperty("latitude");
    expect(parsed).not.toHaveProperty("longitude");
  });

  it("rejects a hotel without a full address or source", () => {
    expect(() =>
      hotelInput.parse({
        name: "MATCH",
        revcontrolCode: "MATCH",
        address: "",
        demandRadiusKm: 25,
        holidayRegion: "south",
        enabledSources: [],
      }),
    ).toThrow();
  });
});

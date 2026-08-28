import { describe, expect, it } from "vitest";

import { hotelInput } from "./schema";

describe("portfolio input", () => {
  it("accepts an address, adjustable radius, holiday region, and sources without coordinates", () => {
    const parsed = hotelInput.parse({
        name: "MATCH",
        revcontrolCode: "MATCH",
        address: "Vestdijk 47, 5611CA Eindhoven",
        addressId: "address-1",
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

  it("rejects typed address text without a selected suggestion", () => {
    const parsed = hotelInput.safeParse({
      name: "MATCH",
      revcontrolCode: "MATCH",
      address: "Kleine Berg 43, 5611 JT Eindhoven",
      addressId: "",
      demandRadiusKm: 25,
      holidayRegion: "south",
      enabledSources: ["claude"],
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.flatten().fieldErrors.addressId).toEqual(["Kies een adres uit de suggesties."]);
  });
});

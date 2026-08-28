import { describe, expect, it, vi } from "vitest";

import { geocodeAddress } from "./geocode";

const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

describe("geocodeAddress", () => {
  it("maps a PDOK BAG address", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({
        features: [{ id: "address-1" }],
      }))
      .mockResolvedValueOnce(response({
        properties: {
          openbare_ruimte_naam: "Vestdijk",
          huisnummer: "47",
          huisletter: null,
          toevoeging: null,
          postcode: "5611CA",
          woonplaats_naam: "Eindhoven",
        },
        geometry: { type: "Point", coordinates: [5.482186, 51.438676] },
      }));

    await expect(geocodeAddress("Vestdijk 47 Eindhoven", fetcher)).resolves.toEqual({
      address: "Vestdijk 47, 5611CA Eindhoven",
      locality: "Eindhoven",
      latitude: 51.438676,
      longitude: 5.482186,
    });
  });

  it("rejects an address PDOK cannot find", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ features: [] }));

    await expect(geocodeAddress("Onbekend adres", fetcher)).rejects.toThrow("Adres niet gevonden");
  });
});

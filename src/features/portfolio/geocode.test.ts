import { describe, expect, it, vi } from "vitest";

import { getAddressById, searchAddresses } from "./geocode";

const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

describe("PDOK addresses", () => {
  it("maps address suggestions", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({
      features: [
        { id: "address-1", properties: { display_name: "Kleine Berg 43, 5611JS Eindhoven" } },
        { id: "address-2", properties: { display_name: "Kleine Berg 45, 5611JS Eindhoven" } },
      ],
    }));

    await expect(searchAddresses("Kleine Berg 43", fetcher)).resolves.toEqual([
      { id: "address-1", label: "Kleine Berg 43, 5611JS Eindhoven" },
      { id: "address-2", label: "Kleine Berg 45, 5611JS Eindhoven" },
    ]);
    expect(String(fetcher.mock.calls[0][0])).toContain("limit=5");
  });

  it("does not search a short query", async () => {
    const fetcher = vi.fn();

    await expect(searchAddresses("Kl", fetcher)).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps a selected PDOK BAG address", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({
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

    await expect(getAddressById("address-1", fetcher)).resolves.toEqual({
      address: "Vestdijk 47, 5611CA Eindhoven",
      locality: "Eindhoven",
      latitude: 51.438676,
      longitude: 5.482186,
    });
  });

  it("rejects an invalid selected address", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("Not found", { status: 404 }));

    await expect(getAddressById("missing", fetcher)).rejects.toThrow("Adres niet gevonden");
  });
});

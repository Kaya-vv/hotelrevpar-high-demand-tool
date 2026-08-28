import { z } from "zod";

const searchResult = z.object({
  features: z.array(z.object({
    id: z.string().min(1),
    properties: z.object({ display_name: z.string().min(1) }),
  })),
});

const addressResult = z.object({
  properties: z.object({
    openbare_ruimte_naam: z.string().min(1),
    huisnummer: z.string().min(1),
    huisletter: z.string().nullable(),
    toevoeging: z.string().nullable(),
    postcode: z.string().min(1),
    woonplaats_naam: z.string().min(1),
  }),
  geometry: z.object({
    type: z.literal("Point"),
    coordinates: z.tuple([z.number(), z.number()]),
  }),
});

async function json(response: Response, notFoundMessage?: string) {
  if (response.status === 404 && notFoundMessage) throw new Error(notFoundMessage);
  if (!response.ok) throw new Error("Adrescontrole is niet beschikbaar. Probeer het later opnieuw.");
  return response.json();
}

export async function searchAddresses(query: string, fetcher: typeof fetch = fetch) {
  if (query.trim().length < 3) return [];

  try {
    const searchUrl = new URL("https://api.pdok.nl/kadaster/location-api/v1/search");
    searchUrl.searchParams.set("q", query.trim());
    searchUrl.searchParams.set("adres[version]", "1");
    searchUrl.searchParams.set("limit", "5");
    searchUrl.searchParams.set("f", "json");

    const search = searchResult.parse(await json(await fetcher(searchUrl, { signal: AbortSignal.timeout(10_000) })));
    return search.features.map(({ id, properties }) => ({ id, label: properties.display_name }));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Adres")) throw error;
    throw new Error("Adrescontrole is niet beschikbaar. Probeer het later opnieuw.");
  }
}

export async function getAddressById(id: string, fetcher: typeof fetch = fetch) {
  try {
    const itemUrl = `https://api.pdok.nl/kadaster/bag/ogc/v2/collections/adres/items/${encodeURIComponent(id)}?f=json`;
    const item = addressResult.parse(await json(
      await fetcher(itemUrl, { signal: AbortSignal.timeout(10_000) }),
      "Adres niet gevonden. Kies het adres opnieuw.",
    ));
    const { properties, geometry } = item;
    const suffix = `${properties.huisletter ?? ""}${properties.toevoeging ? `-${properties.toevoeging}` : ""}`;

    return {
      address: `${properties.openbare_ruimte_naam} ${properties.huisnummer}${suffix}, ${properties.postcode} ${properties.woonplaats_naam}`,
      locality: properties.woonplaats_naam,
      latitude: geometry.coordinates[1],
      longitude: geometry.coordinates[0],
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Adres")) throw error;
    throw new Error("Adrescontrole is niet beschikbaar. Probeer het later opnieuw.");
  }
}

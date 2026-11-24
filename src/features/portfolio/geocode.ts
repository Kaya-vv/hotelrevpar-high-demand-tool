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
    postcode: z.string().min(1).nullable(),
    woonplaats_naam: z.string().min(1),
    bronhouder_naam: z.string().min(1).optional(),
    provincie_naam: z.string().min(1).optional(),
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

// PDOK answers 400 to these characters (`!` and `|` count as search operators), which used to
// surface as "address search unavailable" for an ordinary typo.
const PDOK_REJECTED_CHARACTERS = /[<>*:\\|!]/g;

export async function searchAddresses(query: string, fetcher: typeof fetch = fetch) {
  const cleaned = query.replace(PDOK_REJECTED_CHARACTERS, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length < 3) return [];

  try {
    const searchUrl = new URL("https://api.pdok.nl/kadaster/location-api/v1/search");
    searchUrl.searchParams.set("q", cleaned);
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

/**
 * The town name the searches use. Dutch town names repeat: "Den Hoorn" is a village on Texel and
 * one near Delft. A Texel hotel added in November 2026 had its year-ahead search run around
 * Delft, Rotterdam and The Hague, and received almost no events. A repeated name carries its
 * municipality, "Den Hoorn (Texel)", or its province where the municipality has the same name.
 * The register already names some itself ("Bergen (NH)"); those stay as they are.
 */
async function searchLocality(town: string, municipality: string | undefined, province: string | undefined, fetcher: typeof fetch) {
  const qualifier = municipality && municipality.toLowerCase() !== town.toLowerCase() ? municipality : province;
  if (!qualifier) return town;
  try {
    const url = new URL("https://api.pdok.nl/bzk/locatieserver/search/v3_1/free");
    url.search = new URLSearchParams({ q: `woonplaatsnaam:"${town}"`, fq: "type:woonplaats", rows: "20", fl: "woonplaatsnaam" }).toString();
    const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return town;
    const data = await response.json() as { response: { docs: { woonplaatsnaam: string }[] } };
    const namesakes = data.response.docs.filter((doc) => doc.woonplaatsnaam.toLowerCase() === town.toLowerCase()).length;
    return namesakes > 1 ? `${town} (${qualifier})` : town;
  } catch {
    // The address itself is verified; a failed namesake check must not block saving the hotel.
    return town;
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
      address: `${properties.openbare_ruimte_naam} ${properties.huisnummer}${suffix}, ${[properties.postcode, properties.woonplaats_naam].filter(Boolean).join(" ")}`,
      locality: await searchLocality(properties.woonplaats_naam, properties.bronhouder_naam, properties.provincie_naam, fetcher),
      latitude: geometry.coordinates[1],
      longitude: geometry.coordinates[0],
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Adres")) throw error;
    throw new Error("Adrescontrole is niet beschikbaar. Probeer het later opnieuw.");
  }
}

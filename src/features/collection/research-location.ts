import type { EventCandidate } from "@/features/events/types";
import { normalizeText } from "@/features/events/normalize";

/** Only an unambiguous BAG town match may represent an evidenced host city. */
export async function geocodeCity(city: string, fetcher: typeof fetch = fetch) {
  try {
    const url = new URL("https://api.pdok.nl/bzk/locatieserver/search/v3_1/free");
    url.search = new URLSearchParams({ q: city, fq: "type:woonplaats", rows: "10", fl: "woonplaatsnaam,centroide_ll" }).toString();
    const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const data = await response.json() as { response: { docs: { woonplaatsnaam: string; centroide_ll: string }[] } };
    const matches = data.response.docs.filter((item) => normalizeText(item.woonplaatsnaam) === normalizeText(city));
    if (matches.length !== 1) return null;
    const point = /^POINT\(([-\d.]+) ([-\d.]+)\)$/.exec(matches[0].centroide_ll);
    if (!point) return null;
    return { latitude: Number(point[2]), longitude: Number(point[1]) };
  } catch { return null; }
}

/** Venue first, then an explicitly evidenced host city. Coordinates are application data. */
export function createLocationResolver(options: {
  venue: (query: string) => Promise<{ latitude: number; longitude: number } | null>;
  city?: typeof geocodeCity;
  cache?: Record<string, { latitude: number; longitude: number }>;
}) {
  const cache = options.cache ?? {};
  const pending = new Map<string, Promise<{ latitude: number; longitude: number } | null>>();
  return async (event: Pick<EventCandidate, "venue" | "latitude" | "longitude" | "evidence">) => {
    const evidence = event.evidence;
    if (!evidence) return; // Legacy coordinates remain governed by the existing source policy.
    const city = evidence.hostCity;
    const citySupported = city && evidence.locationText
      && ` ${normalizeText(`${evidence.locationText} ${evidence.hostCityText ?? ""}`)} `.includes(` ${normalizeText(city)} `);
    const venue = evidence.locationScope === "venue" && evidence.locationText && (evidence.venueAddress || event.venue);
    const queries: { query: string; method: "venue" | "city_centroid" }[] = [
      ...(venue ? [{ query: `${venue}${city ? `, ${city}` : ""}`, method: "venue" as const }] : []),
      ...(citySupported ? [{ query: city, method: "city_centroid" as const }] : []),
    ];
    for (const { query, method } of queries) {
      const key = `${method === "city_centroid" ? "city" : "venue"}:${normalizeText(query)}`;
      const previous = evidence.locationResolution;
      let location: { latitude: number; longitude: number } | undefined = previous?.method === method && previous.query === query ? previous : cache[key];
      if (!location) {
        if (!pending.has(key)) pending.set(key, (method === "city_centroid" ? options.city ?? geocodeCity : options.venue)(query).catch(() => null));
        location = (await pending.get(key)) ?? undefined;
      }
      if (!location) continue;
      const point = { latitude: location.latitude, longitude: location.longitude };
      cache[key] = point;
      Object.assign(event, point);
      evidence.locationResolution = { query, method, ...point };
      return;
    }
    event.latitude = null;
    event.longitude = null;
    delete evidence.locationResolution;
  };
}

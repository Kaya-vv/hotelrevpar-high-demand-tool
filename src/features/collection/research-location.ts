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

/**
 * A quoted venue is usually a street, not a building: "Van Heekplein vormde het kloppend hart"
 * or "Start: Boulevard 1945". The building search needs one exact address and a street returns
 * every house number, so it rejected them all. A street centroid is precise enough to measure
 * distance to a hotel, and only an unambiguous street in the named town is accepted.
 */
export async function geocodeStreet(query: string, fetcher: typeof fetch = fetch) {
  const parts = query.split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  const street = parts[0];
  const town = parts.length > 1 ? parts[parts.length - 1] : null;
  try {
    const url = new URL("https://api.pdok.nl/bzk/locatieserver/search/v3_1/free");
    url.search = new URLSearchParams({ q: query, fq: "type:weg", rows: "10", fl: "weergavenaam,centroide_ll" }).toString();
    const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const data = await response.json() as { response: { docs: { weergavenaam: string; centroide_ll: string }[] } };
    const candidates = data.response.docs.flatMap((doc) => {
      const [name, ...rest] = doc.weergavenaam.split(",").map((part) => part.trim());
      if (town && normalizeText(rest.join(" ")) !== normalizeText(town)) return [];
      if (!` ${normalizeText(name)} `.includes(` ${normalizeText(street)} `)) return [];
      return [{ name, point: /^POINT\(([-\d.]+) ([-\d.]+)\)$/.exec(doc.centroide_ll) }];
    }).filter((item) => item.point);
    // An exact street name wins; "Brouwersdam" must not be decided by "Strand Brouwersdam".
    const exact = candidates.filter((item) => normalizeText(item.name) === normalizeText(street));
    const chosen = exact.length === 1 ? exact[0] : candidates.length === 1 ? candidates[0] : null;
    if (!chosen) return null;
    return { latitude: Number(chosen.point![2]), longitude: Number(chosen.point![1]) };
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
    // Enschede Marathon quoted "Van Heekplein" and named Enschede, but the AI graded the page's
    // location "unclear" and that label alone switched the lookup off, so a 75-point event was
    // discarded for having no map point. What matters is whether the page itself named the place:
    // require the venue to appear in the quoted text, and ignore the grade.
    const named = (evidence.venueAddress || event.venue)?.replace(/\s*\([^)]*\)/g, "").trim();
    const quoted = named && ` ${normalizeText(`${evidence.locationText ?? ""} ${evidence.hostCityText ?? ""}`)} `.includes(` ${normalizeText(named)} `);
    // verifyEventEvidence also accepts an address from the host venue's own page.
    // That verified address need not be repeated in the selected location quote.
    const venue = evidence.venueAddress || (quoted ? named : null);
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

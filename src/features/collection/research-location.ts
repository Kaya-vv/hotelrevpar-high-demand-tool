import { distanceKm } from "@/features/events/distance";
import type { EventCandidate } from "@/features/events/types";
import { normalizeText } from "@/features/events/normalize";

type Point = { latitude: number; longitude: number };
/** A research area: its centre and radius. */
export type ResearchArea = Point & { radiusKm: number };
/** The research area a place should fall in; asked only when a town name repeats. */
export type NearArea = () => Promise<ResearchArea | null>;
type PlaceDoc = { woonplaatsnaam?: string; gemeentenaam?: string; provincienaam?: string; centroide_ll: string };

// Everyday names the address register does not use. In November 2026, 75 confirmed events said
// "Den Haag" or "The Hague" and 11 "Den Bosch"; none could be placed on the map.
const townAliases: Record<string, string> = {
  "den haag": "'s-Gravenhage", "the hague": "'s-Gravenhage", "den bosch": "'s-Hertogenbosch",
};

async function searchPlaces(query: string, type: "woonplaats" | "gemeente", fetcher: typeof fetch) {
  const url = new URL("https://api.pdok.nl/bzk/locatieserver/search/v3_1/free");
  url.search = new URLSearchParams({ q: query, fq: `type:${type}`, rows: "10", fl: "woonplaatsnaam,gemeentenaam,provincienaam,centroide_ll" }).toString();
  const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return null;
  return (await response.json() as { response: { docs: PlaceDoc[] } }).response.docs;
}

function centroid(doc: PlaceDoc): Point | null {
  const point = /^POINT\(([-\d.]+) ([-\d.]+)\)$/.exec(doc.centroide_ll);
  return point ? { latitude: Number(point[2]), longitude: Number(point[1]) } : null;
}

/**
 * Places a town named by an event page; only one unambiguous match may stand for it.
 * - "Den Hoorn (Texel)": the part in brackets picks the municipality or province. The register's
 *   own names such as "Bergen (NH)" still match as they are.
 * - "Den Haag" and "Den Bosch" are read as the register's 's-Gravenhage and 's-Hertogenbosch.
 * - A name that two towns share is the one inside `near`, the research area: for a Texel hotel,
 *   "Den Hoorn" is the village on Texel, not the one near Delft.
 * - A municipality that is no town itself ("Texel", "Haarlemmermeer") is placed at its centre.
 */
export async function geocodeCity(city: string, fetcher: typeof fetch = fetch, near?: NearArea) {
  try {
    const name = townAliases[normalizeText(city)] ?? city;
    const qualified = /^(.*\S)\s*\(([^)]+)\)$/.exec(name);
    const towns = await searchPlaces(qualified?.[1] ?? name, "woonplaats", fetcher);
    if (!towns) return null;
    let matches = towns.filter((item) => item.woonplaatsnaam && normalizeText(item.woonplaatsnaam) === normalizeText(name));
    if (!matches.length && qualified) {
      const [, town, qualifier] = qualified;
      matches = towns.filter((item) => item.woonplaatsnaam && normalizeText(item.woonplaatsnaam) === normalizeText(town)
        && [item.gemeentenaam, item.provincienaam].some((value) => value && normalizeText(value) === normalizeText(qualifier)));
    }
    const ambiguous = matches.length > 1;
    if (ambiguous && near) {
      const area = await near();
      if (area) matches = matches.filter((item) => {
        const point = centroid(item);
        return point && distanceKm(area.latitude, area.longitude, point.latitude, point.longitude) <= area.radiusKm;
      });
    }
    if (matches.length === 1) return centroid(matches[0]);
    // Still two candidates, or none of them in the area: no guess, and no municipality of that name.
    if (ambiguous || matches.length || qualified) return null;
    const municipalities = (await searchPlaces(name, "gemeente", fetcher) ?? [])
      .filter((item) => item.gemeentenaam && normalizeText(item.gemeentenaam) === normalizeText(name));
    return municipalities.length === 1 ? centroid(municipalities[0]) : null;
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

type VenuePoint = Point & { venue: string };

/** Words that vary between listings of one hall: "Theater de Meervaart" is "De Meervaart". */
const venueNoise = new Set(["de", "het", "the", "theater", "theatre"]);

/** Ticket-seller listings of halls whose name holds this word, with the coordinates the seller gave. */
async function ticketVenuePoints(word: string): Promise<VenuePoint[]> {
  // Dynamic: the admin client is server-only, which this module's tests cannot load.
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { data, error } = await createAdminClient().from("events")
    .select("venue, latitude, longitude, event_sources!inner(provider)")
    .ilike("venue", `%${word}%`).not("latitude", "is", null).eq("event_sources.provider", "ticketmaster").limit(500);
  if (error) throw error;
  return data.flatMap((row) => row.venue && row.latitude !== null && row.longitude !== null
    ? [{ venue: row.venue, latitude: row.latitude, longitude: row.longitude }] : []);
}

/**
 * The address register knows streets, not halls: "Meervaart" placed the Post-Quantum Cryptography
 * Conference on Amsterdam's centre, 7 km from a hotel 200 m from the door, and on 16 October two
 * thirds of the upcoming researched events sat on a city centre that way, Ahoy and Ziggo Dome
 * included. Ticket sellers give those halls exact coordinates, so a hall named on an organiser's
 * page takes the point its ticketed shows agree on. Same city only, and only a clear majority:
 * a few listings carry the city centre themselves, and one Melkweg listing sat 6 km north.
 */
export async function geocodeKnownVenue(query: string, options: {
  city?: typeof geocodeCity;
  points?: (word: string) => Promise<VenuePoint[]>;
} = {}): Promise<Point | null> {
  const parts = query.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const town = parts[parts.length - 1];
  const townWords = new Set(normalizeText(town).split(" "));
  const words = (name: string) => normalizeText(name.replace(/\([^)]*\)/g, " ")).split(" ")
    .filter((word) => word && !venueNoise.has(word) && !townWords.has(word)).join(" ");
  const hall = words(parts[0]);
  if (!hall) return null;
  try {
    const centre = await (options.city ?? geocodeCity)(town);
    if (!centre) return null;
    const longest = hall.split(" ").sort((left, right) => right.length - left.length)[0];
    const listed = (await (options.points ?? ticketVenuePoints)(longest)).filter((point) => words(point.venue) === hall
      && distanceKm(centre.latitude, centre.longitude, point.latitude, point.longitude) > 0.05
      && distanceKm(centre.latitude, centre.longitude, point.latitude, point.longitude) <= 25);
    const near = (point: Point) => listed.filter((other) => distanceKm(point.latitude, point.longitude, other.latitude, other.longitude) <= 1).length;
    const best = listed.map((point) => ({ point, support: near(point) })).sort((left, right) => right.support - left.support)[0];
    if (!best || best.support < 2 || best.support * 3 < listed.length * 2) return null;
    return { latitude: best.point.latitude, longitude: best.point.longitude };
  } catch { return null; }
}

/** The research area around a search town, placed once and only when a repeated town name asks. */
export function researchArea(location: string, radiusKm: number, city: typeof geocodeCity = geocodeCity): NearArea {
  let area: Promise<ResearchArea | null> | undefined;
  return () => area ??= city(location).then((point) => point && { ...point, radiusKm });
}

/** Venue first, then an explicitly evidenced host city. Coordinates are application data. */
export function createLocationResolver(options: {
  venue: (query: string) => Promise<{ latitude: number; longitude: number } | null>;
  city?: typeof geocodeCity;
  cache?: Record<string, { latitude: number; longitude: number }>;
  /** The research area: decides a town name two places share. */
  near?: NearArea;
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
    // North Sea Jazz and Oasis had confirmed new dates but only their previous editions named
    // Ahoy or Johan Cruijff ArenA. That stored venue is itself audited historical evidence.
    const previousVenue = evidence.previousEditionLocation?.venue;
    const reused = named && previousVenue && normalizeText(named) === normalizeText(previousVenue);
    // verifyEventEvidence also accepts an address from the host venue's own page.
    // That verified address need not be repeated in the selected location quote.
    const venue = evidence.venueAddress || (quoted || reused ? named : null);
    // "Paal 17, Texel": a page that names no host town may still name it after the venue. The
    // Ronde om Texel page said "rond het eiland Texel" and "begint bij Paal 17", never as one phrase.
    const venueTown = !citySupported && named?.includes(",") ? named.split(",").at(-1)!.trim() : null;
    const venueTownQuoted = venueTown && ` ${normalizeText(evidence.locationText ?? "")} `.includes(` ${normalizeText(venueTown)} `);
    const queries: { query: string; method: "venue" | "city_centroid" }[] = [
      ...(venue ? [{ query: `${venue}${city ? `, ${city}` : ""}`, method: "venue" as const }] : []),
      ...(citySupported ? [{ query: city, method: "city_centroid" as const }] : []),
      ...(venueTownQuoted ? [{ query: venueTown, method: "city_centroid" as const }] : []),
    ];
    for (const { query, method } of queries) {
      const key = `${method === "city_centroid" ? "city" : "venue"}:${normalizeText(query)}`;
      const previous = evidence.locationResolution;
      let location: { latitude: number; longitude: number } | undefined = previous?.method === method && previous.query === query ? previous : cache[key];
      if (!location) {
        if (!pending.has(key)) pending.set(key, (method === "city_centroid" ? (options.city ?? geocodeCity)(query, fetch, options.near) : options.venue(query)).catch(() => null));
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

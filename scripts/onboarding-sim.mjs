// Read-only: does a newly onboarded hotel inherit its market's sweep, or pay for its own?
// No writes, no provider calls.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";

const env = Object.fromEntries(readFileSync(".env.production.local", "utf8").split("\n")
  .filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]));
const api = async (path) => {
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`,
    { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
};
const batched = async (ids, build) => {
  const out = [];
  for (let index = 0; index < ids.length; index += 50) out.push(...await api(build(ids.slice(index, index + 50).join(","))));
  return out;
};

const server = await createServer({ configFile: false, logLevel: "error", resolve: { alias: { "@": resolve("src") } }, server: { middlewareMode: true, hmr: false } });
const { claudeDiscoveryDecision, collectionWindow } = await server.ssrLoadModule("/src/features/collection/run.ts");
const { CLAUDE_ASSESSMENT_VERSION } = await server.ssrLoadModule("/src/features/collection/anthropic-batches.ts");
const { distanceKm } = await server.ssrLoadModule("/src/features/events/distance.ts");

const window = collectionWindow();
const areas = await api("collection_areas?select=id,search_location,radius_km,hotel_id");
const hotels = Object.fromEntries((await api("hotels?select=id,latitude,longitude")).map((hotel) => [hotel.id, hotel]));
const runs = await api("collection_runs?select=collection_area_id,finished_at,source_results&finished_at=not.is.null&order=finished_at.desc");
const swept = {};
for (const run of runs) {
  const claude = run.source_results?.claude;
  const succeeded = claude && claude.usage?.nearTermSkipped == null
    && (claude.usage?.nearTermSucceeded === 1
      || (claude.usage?.nearTermSucceeded == null && ["success", "zero"].includes(claude.state)));
  if (succeeded && !swept[run.collection_area_id]) swept[run.collection_area_id] = run.finished_at;
}
const events = await api(`events?select=id,latitude,longitude,start_at&certainty=eq.confirmed&start_at=gte.${window.start}T00:00:00Z&start_at=lte.${window.end}T23:59:59Z&limit=3000`);
const sources = await batched(events.map((event) => event.id),
  (ids) => `event_sources?select=event_id,checked_at,assessment_version,source_state&provider=eq.claude&event_id=in.(${ids})`);
const newest = {};
for (const source of sources) {
  const previous = newest[source.event_id];
  if (!previous || source.checked_at > previous.checked_at) newest[source.event_id] = source;
}

console.log(`window ${window.start}..${window.end} | reusable assessment version >= ${CLAUDE_ASSESSMENT_VERSION}\n`);
console.log("A new client hotel is added to each market Robert already covers, then refreshed:\n");
console.log("market              market swept  adoptable   new hotel's near-term sweep");
for (const area of areas.sort((left, right) => left.search_location.localeCompare(right.search_location))) {
  const hotel = hotels[area.hotel_id];
  const marketSweptAt = swept[area.id] ?? null;
  const adoptable = events.filter((event) => {
    const source = newest[event.id];
    if (!source || source.source_state !== "active" || source.assessment_version < CLAUDE_ASSESSMENT_VERSION) return false;
    return event.latitude !== null && event.longitude !== null
      && distanceKm(hotel.latitude, hotel.longitude, event.latitude, event.longitude) <= area.radius_km;
  }).length;
  const pays = claudeDiscoveryDecision({
    trigger: "manual", ownSweptAt: null, marketSweptAt, inheritedEvidence: adoptable > 0,
  });
  console.log(`${`${area.search_location} ${area.radius_km}km`.padEnd(21)}${(marketSweptAt ?? "never").slice(0, 10)}  ${String(adoptable).padStart(5)}       ${pays ? "pays $7.34 (nothing to inherit)" : "INHERITS -> $0"}`);
}
await server.close();

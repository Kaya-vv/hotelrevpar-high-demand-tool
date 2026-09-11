// Stamps the new lookup columns on rows written before they existed.
//
// Every stored row is verified before it is stamped: the recomputed key must equal the stored
// primary key. A row whose key cannot be reproduced was written by different settings or an older
// assessment version, so it is left alone and simply never reused — the safe outcome.
//
// Usage: node scripts/backfill-market-radius.mjs [--apply]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const apply = process.argv.includes("--apply");
const env = Object.fromEntries(
  readFileSync(".env.production.local", "utf8")
    .split("\n")
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
);
const rest = async (path, init) => {
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
};

const city = (value) => value.trim().toLocaleLowerCase("nl-NL");
const sha = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// The key formula in use before the radius moved into its own column.
const previousCacheKey = (row, version) => sha({
  version,
  discoveryVersion: 2,
  start: row.window_start,
  end: row.window_end,
  location: city(row.search_location),
  radiusKm: row.radius_km,
  model: row.model,
  discoveryModel: row.discovery_model,
});
const groupKey = (row, version) => sha({
  version,
  discoveryVersion: 2,
  start: row.window_start,
  end: row.window_end,
  location: city(row.search_location),
  model: row.model,
  discoveryModel: row.discovery_model,
});

const version = Number(
  readFileSync("src/features/collection/anthropic-batches.ts", "utf8").match(/CLAUDE_ASSESSMENT_VERSION = (\d+)/)[1],
);
console.log(`assessment version ${version}; ${apply ? "APPLYING" : "dry run"}\n`);

console.log("=== 90-day searches ===");
const cache = await rest("claude_market_cache?select=cache_key,search_location,radius_km,window_start,window_end,model,discovery_model,market_key");
for (const row of cache) {
  if (row.market_key) { console.log(`  ${row.search_location} ${row.radius_km}km already stamped`); continue; }
  if (previousCacheKey(row, version) !== row.cache_key) {
    console.log(`  ${row.search_location} ${row.radius_km}km SKIP - key does not reproduce, not reusable`);
    continue;
  }
  const key = groupKey(row, version);
  if (apply) await rest(`claude_market_cache?cache_key=eq.${row.cache_key}`, { method: "PATCH", body: JSON.stringify({ market_key: key }) });
  console.log(`  ${row.search_location} ${row.radius_km}km -> ${key.slice(0, 12)}`);
}

console.log("\n=== year-ahead markets ===");
const [markets, areas] = await Promise.all([
  rest("long_range_markets?select=market_key,search_location,radius_km"),
  rest("collection_areas?select=search_location,radius_km&hotel_id=not.is.null"),
]);
// A market's key is the hash of its city and radius. Hotels name the cities, but a hotel whose
// radius has since been edited leaves its old market unnamed, so each city is tried against the
// radiuses in use plus the usual round values. Every candidate is confirmed by reproducing the
// stored key, so a wrong guess can never be written.
const radiuses = [...new Set([...areas.map((area) => area.radius_km), 10, 15, 20, 25, 30, 40, 50, 75, 100])];
const byKey = new Map();
for (const area of areas) {
  for (const radiusKm of radiuses) byKey.set(sha([city(area.search_location), radiusKm]), { location: city(area.search_location), radiusKm });
}
for (const market of markets) {
  if (market.search_location) { console.log(`  ${market.search_location} ${market.radius_km}km already stamped`); continue; }
  const found = byKey.get(market.market_key);
  if (!found) { console.log(`  ${market.market_key.slice(0, 12)} SKIP - city and radius not identifiable`); continue; }
  const body = { search_location: found.location, radius_km: found.radiusKm };
  if (apply) await rest(`long_range_markets?market_key=eq.${market.market_key}`, { method: "PATCH", body: JSON.stringify(body) });
  console.log(`  ${market.market_key.slice(0, 12)} -> ${body.search_location} ${body.radiusKm ?? body.radius_km}km`);
}

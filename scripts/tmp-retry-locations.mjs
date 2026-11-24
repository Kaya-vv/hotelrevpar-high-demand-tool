// One-off: place confirmed research events that had no map point, with the new place rules, and
// publish them to the hotels of that market. Map lookups only (free address register), no AI.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { createServer } from "vite";

const env = Object.fromEntries(readFileSync(".env.production.local", "utf8").split("\n")
  .filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]));
process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const serverOnly = createRequire(import.meta.url).resolve("server-only").replace(/index\.js$/, "empty.js");
const server = await createServer({ configFile: false, logLevel: "error",
  resolve: { alias: { "@": resolve("src"), "server-only": serverOnly } },
  ssr: { noExternal: ["server-only"] }, server: { middlewareMode: true, hmr: false } });
const load = (path) => server.ssrLoadModule(path);
const { createAdminClient } = await load("/src/lib/supabase/admin.ts");
const { createLongRangeStore, marketLocation } = await load("/src/features/collection/long-range-store.ts");
const { createLocationResolver, researchArea } = await load("/src/features/collection/research-location.ts");
const { geocodeEventVenue } = await load("/src/features/collection/sources/claude.ts");
const { validEventRange } = await load("/src/features/events/normalize.ts");
const { storedLongRangeResult } = await load("/src/features/collection/market-research.ts");
const { publishLongRangeResult } = await load("/src/features/collection/run.ts");
const { createCollectionRepository } = await load("/src/features/collection/repository.ts");
const admin = createAdminClient();
const store = createLongRangeStore();
const repository = createCollectionRepository();
const dryRun = process.argv.includes("--dry");

const { data: markets, error } = await admin.from("long_range_markets").select("market_key, search_location, radius_km");
if (error) throw error;
const { data: areas, error: areaError } = await admin.from("collection_areas")
  .select("id, account_id, search_location, radius_km, accounts!inner(active, trial_ends_at), hotels!inner(archived_at)")
  .is("hotels.archived_at", null).eq("accounts.active", true).is("accounts.trial_ends_at", null).contains("enabled_sources", ["claude"]);
if (areaError) throw areaError;

let totalPlaced = 0;
for (const market of markets) {
  const matching = areas.filter((area) => marketLocation(area.search_location) === market.search_location && area.radius_km <= market.radius_km);
  if (!matching.length) continue;
  const label = `${market.search_location} (${market.radius_km} km)`.padEnd(32);
  if (!await store.acquire(market.market_key, { location: market.search_location, radiusKm: market.radius_km })) { console.log(`${label} SKIPPED: research running`); continue; }
  try {
    const state = await store.load(market.market_key);
    if (!state) continue;
    state.locations ??= {};
    const place = createLocationResolver({ venue: geocodeEventVenue, cache: state.locations, near: researchArea(market.search_location, market.radius_km) });
    let waiting = 0, placed = 0;
    for (const lead of state.leads) {
      for (const event of lead.editions) {
        if (!event.primarySourceConfirmed || !validEventRange(event) || (event.latitude !== null && event.longitude !== null)) continue;
        waiting += 1;
        await place(event);
        if (event.latitude !== null && event.longitude !== null) placed += 1;
        if (process.env.DETAIL && market.search_location.includes(process.env.DETAIL)) console.log(`   ${event.latitude !== null ? "PLACED " : "still  "} ${event.title} | venue=${event.venue} | host=${event.evidence?.hostCity}`);
      }
      // The next research pass settles the stage again; until then no search is bought for a place.
      if (lead.pendingStage === "location" && lead.editions.every((event) => event.latitude !== null && event.longitude !== null)) delete lead.pendingStage;
    }
    totalPlaced += placed;
    if (!placed) { console.log(`${label} ${waiting} waiting, 0 placed`); continue; }
    if (dryRun) { console.log(`${label} ${waiting} waiting, ${placed} placed (dry run)`); continue; }
    const { data: refreshing, error: refreshError } = await admin.from("collection_runs").select("id").in("collection_area_id", matching.map((area) => area.id)).is("finished_at", null).limit(1);
    if (refreshError) throw refreshError;
    state.publicationPending = true;
    await store.save(market.market_key, state);
    if (refreshing.length) { console.log(`${label} ${waiting} waiting, ${placed} placed; saved, hotel refresh running so it publishes then`); continue; }
    const result = storedLongRangeResult(state);
    for (const area of matching) await publishLongRangeResult(repository, await repository.loadContext(area.account_id, area.id), result);
    console.log(`${label} ${waiting} waiting, ${placed} placed, published to ${matching.length} hotel(s)`);
  } finally {
    await store.release(market.market_key);
  }
}
console.log("placed in total:", totalPlaced);
await server.close();

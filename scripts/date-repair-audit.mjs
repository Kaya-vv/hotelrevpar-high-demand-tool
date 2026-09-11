// Read-only: replays the live cached city results through the real repair helper.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";

const env = Object.fromEntries(
  readFileSync(".env.production.local", "utf8")
    .split("\n")
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
);
const q = async (path) => {
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
};

const server = await createServer({
  configFile: false,
  logLevel: "error",
  resolve: { alias: { "@": resolve("src") } },
  server: { middlewareMode: true },
});
const { repairEventRange } = await server.ssrLoadModule("/src/features/events/normalize.ts");

const cache = await q("claude_market_cache?select=search_location,radius_km,created_at,result&order=created_at.desc&limit=20");
const seen = new Set();
let kept = 0;
let dropped = 0;
let repaired = 0;
let crashesBefore = 0;

for (const row of cache) {
  const key = `${row.search_location}|${row.radius_km}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const candidates = row.result?.candidates ?? [];
  const lines = [];
  for (const event of candidates) {
    const start = Date.parse(event.startAt);
    const end = Date.parse(event.endAt);
    const unusable = !Number.isFinite(start) || !Number.isFinite(end) || end < start;
    // Only a candidate with coordinates survives the radius filter and reaches the save.
    if (unusable && event.latitude !== null && event.longitude !== null) crashesBefore += 1;
    const fixed = repairEventRange(event);
    if (!fixed) {
      dropped += 1;
      lines.push(`   DROP  "${String(event.title).slice(0, 44)}" start=${JSON.stringify(event.startAt)} end=${JSON.stringify(event.endAt)}`);
      continue;
    }
    kept += 1;
    if (fixed.endAt !== event.endAt) {
      repaired += 1;
      lines.push(`   KEEP  "${String(event.title).slice(0, 44)}" end ${event.endAt} -> ${fixed.endAt}`);
    }
  }
  if (lines.length) {
    console.log(`${row.search_location} ${row.radius_km}km (${candidates.length} events, cached ${row.created_at.slice(0, 16)})`);
    console.log(lines.join("\n"));
  }
}

console.log(`\nevents that aborted a run before the fix: ${crashesBefore}`);
console.log(`after the fix: kept ${kept}, of which repaired ${repaired}; dropped ${dropped}; aborts 0`);
await server.close();

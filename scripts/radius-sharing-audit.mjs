// Read-only: asks the live database what each hypothetical new hotel would reuse.
// No writes, no provider calls.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";

const env = Object.fromEntries(
  readFileSync(".env.production.local", "utf8")
    .split("\n")
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
);
for (const [key, value] of Object.entries(env)) process.env[key] ??= value;
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
const { coveringMarket } = await server.ssrLoadModule("/src/features/collection/long-range-store.ts");

const cache = await q("claude_market_cache?select=market_key,search_location,radius_km,window_start,window_end,result");
const markets = await q("long_range_markets?select=market_key,search_location,radius_km,requestedAt:state->research->>requestedAt,publishedAt:state->>publishedAt");
const city = (value) => value.trim().toLocaleLowerCase("nl-NL");

// The narrowest saved 90-day search of this city that still covers the radius, matching the
// column lookup in loadClaudeMarketResult.
const coveringSearch = (location, radiusKm) =>
  cache
    .filter((row) => row.market_key && city(row.search_location) === city(location) && row.radius_km >= radiusKm)
    .sort((left, right) => left.radius_km - right.radius_km)[0] ?? null;

const cases = [
  ["Eindhoven", 25, "colleague copies The Match exactly"],
  ["Eindhoven", 20, "colleague picks a tighter radius"],
  ["Eindhoven", 15, "colleague picks a much tighter radius"],
  ["Eindhoven", 30, "colleague picks a wider radius"],
  ["Eindhoven", 50, "colleague picks a much wider radius"],
  ["eindhoven", 25, "lower case city"],
  ["Heeze", 50, "Kapellerput today"],
  ["Heeze", 75, "Kapellerput widened"],
  ["Amsterdam", 25, "second Amsterdam hotel, wider than Hegra"],
  ["Amsterdam", 10, "second Amsterdam hotel, tighter than Hegra"],
  ["Breda", 25, "a genuinely new city"],
];

console.log("hotel a new client would create                 90-day search        year-ahead research");
console.log("-".repeat(104));
for (const [location, radiusKm, label] of cases) {
  const search = coveringSearch(location, radiusKm);
  const market = coveringMarket(markets, location, radiusKm);
  const searchText = search
    ? `reuse ${search.radius_km}km (${search.result?.candidates?.length ?? 0} events)`
    : "PAYS ~$7";
  const marketText = market
    ? `reuse ${market.radius_km}km (${market.publishedAt ? "published" : market.requestedAt ? "in progress" : "not started"})`
    : "PAYS ~$3";
  console.log(`${`${location} ${radiusKm}km`.padEnd(22)} ${label.padEnd(42)} ${searchText.padEnd(23)} ${marketText}`);
}
await server.close();

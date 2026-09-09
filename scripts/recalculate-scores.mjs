// Recalculate stored hotel_event_scores through the real repository path. No provider calls.
// Skips areas with a live collection job: that job ends by recalculating the same rows itself.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { createServer } from "vite";

const env = Object.fromEntries(readFileSync(".env.production.local", "utf8").split("\n")
  .filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]));
process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const api = async (path) => {
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`,
    { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
};

// `repository.ts` reaches the `server-only` marker through the admin client. This script IS
// server-side, so point the marker at the empty module the package itself publishes for
// server contexts. Aliasing to an absolute path also keeps Vite from externalising it.
const serverOnly = createRequire(import.meta.url).resolve("server-only").replace(/index\.js$/, "empty.js");
const server = await createServer({ configFile: false, logLevel: "error",
  resolve: { alias: { "@": resolve("src"), "server-only": serverOnly } },
  ssr: { noExternal: ["server-only"] },
  server: { middlewareMode: true, hmr: false } });
const { createCollectionRepository } = await server.ssrLoadModule("/src/features/collection/repository.ts");
const repository = createCollectionRepository();

const areas = await api("collection_areas?select=id,name,account_id");
const live = await api("collection_jobs?select=collection_area_id,status&status=in.(queued,running)");
const busy = new Set(live.map((job) => job.collection_area_id));

for (const area of areas) {
  if (busy.has(area.id)) {
    console.log(`${area.name.padEnd(42)} SKIPPED — collection job in flight`);
    continue;
  }
  const context = await repository.loadContext(area.account_id, area.id);
  const publication = await repository.recalculateScores(context);
  console.log(`${area.name.padEnd(42)} recalculated${publication ? ` — publication ${JSON.stringify(publication)}` : ""}`);
}
await server.close();

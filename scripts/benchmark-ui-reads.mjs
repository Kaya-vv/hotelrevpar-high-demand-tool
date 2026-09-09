import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "vite";
import { createClient } from "@supabase/supabase-js";

// Explicit, bounded database reads only. No auth writes, workers or provider calls.
const production = process.argv.includes("--production-read-only");
process.loadEnvFile(production ? ".env.production.local" : ".env.local");
const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin;
if (
  !production &&
  !["127.0.0.1", "localhost"].includes(new URL(origin).hostname)
)
  throw new Error("Use --production-read-only for a remote database");
const root = resolve("refs/ui-optimization");
mkdirSync(root, { recursive: true });
const originalFetch = globalThis.fetch;
let reads = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method =
    init?.method ?? (input instanceof Request ? input.method : "GET");
  if (url.origin !== origin || !["GET", "HEAD"].includes(method.toUpperCase()))
    throw new Error("Benchmark permits database reads only");
  const start = performance.now();
  const response = await originalFetch(input, {
    ...init,
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.clone().text();
  reads.push({
    table: url.pathname.split("/").at(-1),
    bytes: Buffer.byteLength(body),
    ms: Math.round(performance.now() - start),
    status: response.status,
  });
  return response;
};
const db = createClient(origin, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const checked = (result) => {
  if (result.error) throw result.error;
  return result.data;
};
const adapter = resolve(root, "scope.mjs");
writeFileSync(
  adapter,
  "let scope; export const configure = value => { scope = value; }; export const getHotelScope = async () => scope; export const createServerClient = async () => scope.supabase; export const createAdminClient = () => scope.supabase;\n",
);
const empty = resolve(root, "server-only.mjs");
writeFileSync(empty, "export {};\n");
const baseline = resolve(root, "baseline-calendar.mjs");
// Vite transpiles the original TypeScript through a .ts extension.
const baselineTs = baseline.replace(/mjs$/, "ts");
const originalCode = execFileSync(
  "git",
  ["show", "HEAD:src/features/calendar/query.ts"],
  { encoding: "utf8" },
);
writeFileSync(
  baselineTs,
  originalCode
    .replaceAll('"./', '"@/features/calendar/')
    .replaceAll('"../', '"@/features/'),
);
const server = await createServer({
  configFile: false,
  logLevel: "error",
  server: { middlewareMode: true, hmr: false },
  resolve: {
    alias: {
      "@/lib/supabase/server": adapter,
      "@/lib/supabase/admin": adapter,
      "@/features/workspace/hotel-context": adapter,
      "server-only": empty,
      "@": resolve("src"),
    },
  },
});
try {
  const requestedArea = process.argv
    .find((value) => value.startsWith("--area="))
    ?.slice(7);
  let jobQuery = db
    .from("collection_jobs")
    .select("account_id, collection_area_id")
    .order("created_at", { ascending: false })
    .limit(1);
  if (requestedArea)
    jobQuery = jobQuery.eq("collection_area_id", requestedArea);
  const latest = checked(await jobQuery.single());
  const area = checked(
    await db
      .from("collection_areas")
      .select("id, hotel_id, enabled_sources")
      .eq("id", latest.collection_area_id)
      .single(),
  );
  const hotels = checked(
    await db
      .from("hotels")
      .select("id, name, demand_radius_km")
      .eq("account_id", latest.account_id),
  );
  const { configure } = await server.ssrLoadModule(adapter);
  configure({
    supabase: db,
    hotels,
    selectedHotelId: area.hotel_id,
    areaId: area.id,
    enabledSources: area.enabled_sources,
  });
  const before = await server.ssrLoadModule(baselineTs);
  const after = await server.ssrLoadModule("/src/features/calendar/query.ts");
  const report = {
    capturedAt: new Date().toISOString(),
    role: "service_role (not an authenticated browser/RLS trace)",
    origin,
    baselineCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    measurements: [],
  };
  const month = new Date().toISOString().slice(0, 7);
  for (const filters of [
    { month, view: "calendar" },
    { month, view: "list", period: "all" },
  ]) {
    const results = [];
    for (const [label, module] of [
      ["before", before],
      ["after", after],
    ]) {
      reads = [];
      const start = performance.now();
      const result = await module.getCalendarData(latest.account_id, filters);
      results.push(result);
      report.measurements.push({
        label,
        filters,
        ms: Math.round(performance.now() - start),
        queries: reads.length,
        databaseBytes: reads.reduce((sum, read) => sum + read.bytes, 0),
        eventCount: result.events.length,
        reads,
      });
    }
    // Old source reads had no ordering. Pagination now orders by ID; compare link
    // sets, while retaining strict event ordering and all other output fields.
    for (const result of results)
      for (const event of result.events)
        event.sources.sort((a, b) =>
          JSON.stringify(a).localeCompare(JSON.stringify(b)),
        );
    if (JSON.stringify(results[0]) !== JSON.stringify(results[1])) {
      const differences = [];
      const compare = (a, b, path) => {
        if (JSON.stringify(a) === JSON.stringify(b)) return;
        if (a && b && typeof a === "object" && typeof b === "object") {
          for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
            compare(a[key], b[key], `${path}.${key}`);
        } else differences.push({ path, before: a, after: b });
      };
      compare(results[0], results[1], "result");
      console.log(JSON.stringify(differences.slice(0, 12), null, 2));
      throw new Error(`Calendar parity failed for ${JSON.stringify(filters)}`);
    }
  }
  const { getCollectionStatus } = await server.ssrLoadModule(
    "/src/features/collection/status.ts",
  );
  reads = [];
  const status = await getCollectionStatus(latest.account_id, area.id);
  report.status = {
    responseBytes: Buffer.byteLength(JSON.stringify(status)),
    databaseBytes: reads.reduce((sum, read) => sum + read.bytes, 0),
    queries: reads.length,
    reads,
  };
  report.parity =
    "Identical output except previously unspecified source-link order";
  writeFileSync(
    resolve(root, `report-${area.id}.json`),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        ...report,
        measurements: report.measurements.map((measurement) => ({
          ...measurement,
          reads: undefined,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}

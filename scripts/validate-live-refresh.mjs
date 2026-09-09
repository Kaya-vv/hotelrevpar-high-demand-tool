// Live provider evaluation through the actual Refresh and background publication code.
// All database writes stay in isolated local Supabase; no answer-key input is supplied.
import { execSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";
import { createClient } from "@supabase/supabase-js";

if (!process.argv.includes("--allow-paid")) throw new Error("Live API calls require --allow-paid");
const root = resolve("refs/live-refresh-eindhoven");
mkdirSync(root, { recursive: true });
const attempt = resolve(root, `attempt-${Date.now()}`);
mkdirSync(attempt);
const save = (name, value) => {
  const json = JSON.stringify(value, null, 2);
  writeFileSync(resolve(root, name), json);
  writeFileSync(resolve(attempt, name), json);
};
const runner = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const local = JSON.parse(execSync(`${runner} exec supabase status --workdir refs/live-refresh-db -o json`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
if (local.API_URL !== "http://127.0.0.1:54431") throw new Error("Isolated database required");
process.loadEnvFile(".env.local");
process.env.NEXT_PUBLIC_SUPABASE_URL = local.API_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = local.SERVICE_ROLE_KEY;
process.env.ANTHROPIC_BATCHES = "disabled";
// Verified from deployed configuration and production usage records. Vercel masks
// these settings as sensitive when pulling env; local development omitted long-range.
process.env.LONG_RANGE_DISCOVERY = "enabled";
delete process.env.LONG_RANGE_MARKETS;
process.env.ANTHROPIC_MODEL = "claude-sonnet-5";
process.env.ANTHROPIC_DISCOVERY_MODEL = "claude-sonnet-5";
process.env.ANTHROPIC_TRIAGE_MODEL = "claude-haiku-4-5-20251001";
const db = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const checked = result => { if (result.error) throw result.error; return result.data; };
const queue = [];
globalThis.__refreshQueue = queue;
const recordings = { startedAt: new Date().toISOString(), network: [], pages: [], summaries: [] };
save("manifest.json", { capturedAt: recordings.startedAt, batching: false,
  model: process.env.ANTHROPIC_MODEL, discoveryModel: process.env.ANTHROPIC_DISCOVERY_MODEL,
  triageModel: process.env.ANTHROPIC_TRIAGE_MODEL, longRangeDiscovery: process.env.LONG_RANGE_DISCOVERY,
  gitHead: execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(),
  workingDiffSha256: createHash("sha256").update(execSync("git diff -- src", { stdio: ["ignore", "pipe", "ignore"] })).digest("hex"),
  scope: "Live APIs; real Refresh, research, persistence and calendar code; isolated database; queue delivery drained locally" });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const raw = input instanceof Request ? input.url : String(input);
  const url = new URL(raw);
  if (url.origin === local.API_URL) return originalFetch(input, init);
  if (url.hostname.endsWith("supabase.co")) throw new Error("Production database access blocked");
  if (url.pathname.includes("/messages/batches")) throw new Error("Batch request forbidden in direct evaluation");
  for (const key of [...url.searchParams.keys()]) if (/key|token|secret/i.test(key)) url.searchParams.set(key, "REDACTED");
  const request = { url: url.href, method: init?.method ?? (input instanceof Request ? input.method : "GET"), body: typeof init?.body === "string" ? init.body : null };
  const entry = { request, startedAt: new Date().toISOString() };
  recordings.network.push(entry);
  save("recordings.json", recordings);
  try {
    const response = await originalFetch(input, init);
    entry.response = { status: response.status, body: await response.clone().text() };
    return response;
  } catch (error) { entry.error = String(error); throw error; }
  finally { entry.finishedAt = new Date().toISOString(); save("recordings.json", recordings); }
};
globalThis.__recordOfficialPage = async (url, fetcher) => {
  const entry = { url, startedAt: new Date().toISOString() };
  recordings.pages.push(entry);
  try { entry.page = await fetcher(url); return entry.page; }
  catch (error) { entry.error = String(error); throw error; }
  finally { save("recordings.json", recordings); }
};
const adapter = resolve(root, "adapter.mjs");
writeFileSync(adapter, "export const publishCollectionJob = async work => { globalThis.__refreshQueue.push(work); }; export const getHotelScope = async () => globalThis.__refreshScope; export const createServerClient = async () => globalThis.__refreshScope.supabase;\n");
const empty = resolve(root, "empty.mjs");
writeFileSync(empty, "export {};\n");
const server = await createServer({ configFile: false, logLevel: "error", server: { middlewareMode: true, hmr: false },
  resolve: { alias: { "@/lib/supabase/server": adapter, "@/features/workspace/hotel-context": adapter, "server-only": empty, "@": resolve("src") } },
  plugins: [{ name: "capture-refresh-boundaries", enforce: "pre",
    resolveId(source, importer) { if (source === "./jobs" && importer?.replaceAll("\\", "/").includes("/collection/")) return adapter; },
    transform(code, id) {
      if (!id.replaceAll("\\", "/").endsWith("/collection/official-pages.ts")) return;
      return code.replace("export const fetchOfficialPage: PageFetcher", "const originalFetchOfficialPage: PageFetcher")
        + "\nexport const fetchOfficialPage: PageFetcher = url => (globalThis as any).__recordOfficialPage(url, originalFetchOfficialPage);\n";
    },
  }],
});
try {
  let setup;
  if (process.argv.includes("--continue")) setup = JSON.parse(readFileSync(resolve(root, "setup.json"), "utf8"));
  else {
    const existing = await db.from("events").select("id", { head: true, count: "exact" });
    if (existing.error || existing.count) throw new Error("Initial evaluation requires an empty isolated events database");
    const market = JSON.parse(readFileSync("tests/fixtures/hotel-demand-production.json", "utf8")).filter(row => row.market === "eindhoven").at(-1);
    const accountId = randomUUID(), hotelId = randomUUID();
    checked(await db.from("accounts").insert({ id: accountId, name: "Automatic Eindhoven validation" }));
    const hotel = checked(await db.from("hotels").insert({ ...market.hotel, id: hotelId, account_id: accountId, revcontrol_code: "LIVE-EVAL", search_location: "Eindhoven" }).select().single());
    const area = checked(await db.from("collection_areas").select("*").eq("hotel_id", hotelId).single());
    const ids = new Map(market.rows.map(row => [row.event.id, randomUUID()]));
    checked(await db.from("events").insert(market.rows.map(row => ({ ...row.event, id: ids.get(row.event.id) }))));
    checked(await db.from("event_sources").insert(market.rows.flatMap(row => row.sources.map(source => ({ ...source, event_id: ids.get(row.event.id) })))));
    checked(await db.from("account_events").insert(market.rows.map(row => ({ account_id: accountId, event_id: ids.get(row.event.id), state: row.decision.state ?? "needs_review", review_reason: row.decision.review_reason }))));
    checked(await db.from("account_event_areas").insert([...ids.values()].map(event_id => ({ account_id: accountId, collection_area_id: area.id, event_id }))));
    setup = { accountId, hotel, area, capturedAt: recordings.startedAt, source: "Original September 7 production rows; no researched additions" };
    save("setup.json", setup);
    save("starting-rows.json", market);
  }
  globalThis.__refreshScope = { supabase: db, hotels: [setup.hotel], selectedHotelId: setup.hotel.id, areaId: setup.area.id, enabledSources: setup.area.enabled_sources };
  const { runCollection } = await server.ssrLoadModule("/src/features/collection/run.ts");
  const { processMarketWork } = await server.ssrLoadModule("/src/features/collection/market-research.ts");
  const { getCalendarData } = await server.ssrLoadModule("/src/features/calendar/query.ts");
  const { evaluateDemandAcceptance } = await server.ssrLoadModule("/tests/helpers/demand-acceptance.ts");
  console.log("Starting live, non-batched Eindhoven Refresh using original production inputs");
  const result = await runCollection({ accountId: setup.accountId, areaId: setup.area.id, trigger: "manual" });
  recordings.summaries.push(result); save("recordings.json", recordings);
  console.log(`Main Refresh: ${result.status}; ${queue.length} background job(s)`);
  if (!queue.some(work => work.kind === "market-research")) throw new Error("Full-pipeline validation requires automatic background research enqueue");
  while (queue.length) {
    save("queue.json", queue);
    const work = queue.shift(); console.log(`Processing ${work.kind}`);
    await processMarketWork(work);
    save("queue.json", queue);
  }
  const calendar = await getCalendarData(setup.accountId, { month: new Date().toISOString().slice(0, 7), view: "list", period: "all" });
  save("calendar.json", calendar);
  // Answer key is read for the first time after the entire actual pipeline has returned.
  const key = JSON.parse(readFileSync("tests/fixtures/hotel-demand-expectations.json", "utf8"));
  const report = evaluateDemandAcceptance({ expected: key.positives.filter(row => row.market === "eindhoven"), negativePatterns: key.negativePatterns, calendar: calendar.events, traces: [],
    complete: Boolean(calendar.latestRun?.finishedAt) && !calendar.latestRun?.researchPending,
    integrityErrors: result.status === "completed" ? [] : [`Main Refresh ended with status ${result.status}`] });
  save("report.json", report);
  save("final-markets.json", checked(await db.from("long_range_markets").select("*")));
  console.log(JSON.stringify({ status: report.status, recall: `${report.positiveRecall}/${report.expectedPositives}`, falsePositives: report.falsePositives, calendar: calendar.events.map(row => row.title) }, null, 2));
  process.exitCode = report.passed ? 0 : 2;
} finally {
  save("recordings.json", recordings);
  globalThis.fetch = originalFetch;
  await server.close();
}

// Read-only production check. The answer key is loaded after the real calendar query.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";

const localEvaluation = process.argv.includes("--local-evaluation");
if (localEvaluation) {
  const runner = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const local = JSON.parse(execSync(`${runner} exec supabase status --workdir refs/live-refresh-db -o json`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  if (local.API_URL !== "http://127.0.0.1:54431") throw new Error("Unexpected evaluation database");
  process.env.NEXT_PUBLIC_SUPABASE_URL = local.API_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = local.SERVICE_ROLE_KEY;
} else process.loadEnvFile(".env.production.local");
const root = resolve(localEvaluation ? "refs/live-refresh-eindhoven/audit" : "refs/demand-acceptance");
mkdirSync(root, { recursive: true });
const originalFetch = globalThis.fetch;
const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  if (url.origin !== origin || !["GET", "HEAD"].includes(method.toUpperCase())) throw new Error("Audit permits database reads only");
  return originalFetch(input, { ...init, signal: AbortSignal.timeout(30_000) });
};
const db = createClient(origin, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const checked = result => { if (result.error) throw result.error; return result.data; };
const adapter = resolve(root, "calendar-scope.mjs");
writeFileSync(adapter, "let scope; export const configure = value => { scope = value; }; export const getHotelScope = async () => scope; export const createServerClient = async () => scope.supabase;\n");
const empty = resolve(root, "server-only.mjs");
writeFileSync(empty, "export {};\n");
const server = await createServer({ configFile: false, logLevel: "error", server: { middlewareMode: true, hmr: false },
  resolve: { alias: { "@/lib/supabase/server": adapter, "@/features/workspace/hotel-context": adapter, "server-only": empty, "@": resolve("src") } } });
try {
  const { configure } = await server.ssrLoadModule(adapter);
  const { getCalendarData } = await server.ssrLoadModule("/src/features/calendar/query.ts");
  const { longRangeMarketKey } = await server.ssrLoadModule("/src/features/collection/long-range-store.ts");
  const { evaluateDemandAcceptance } = await server.ssrLoadModule("/tests/helpers/demand-acceptance.ts");
  const { readDemandAssessment } = await server.ssrLoadModule("/src/features/events/demand-assessment.ts");
  const { fetchAllRows, fetchInBatches } = await server.ssrLoadModule("/src/lib/supabase/fetch-in-batches.ts");
  const targets = localEvaluation ? [{ market: "eindhoven", hotelId: JSON.parse(readFileSync("refs/live-refresh-eindhoven/setup.json", "utf8")).hotel.id }] : [
    { market: "utrecht", hotelId: "71f162de-d941-4880-9ba5-83a3543e841f" },
    { market: "eindhoven", hotelId: "c22bedf2-178a-4932-9874-6c4d2913722e" },
  ];
  const outputs = [];
  for (const target of targets) {
    const hotel = checked(await db.from("hotels").select("*").eq("id", target.hotelId).single());
    const area = checked(await db.from("collection_areas").select("*").eq("hotel_id", hotel.id).single());
    configure({ supabase: db, hotels: [hotel], selectedHotelId: hotel.id, areaId: area.id, enabledSources: area.enabled_sources });
    const calendar = await getCalendarData(hotel.account_id, { month: new Date().toISOString().slice(0, 7), view: "list", period: "all" });
    const jobs = checked(await db.from("collection_jobs").select("id,status,started_at,pending_since").eq("collection_area_id", area.id).in("status", ["queued", "running"]));
    const market = checked(await db.from("long_range_markets").select("state").eq("market_key", longRangeMarketKey(area.search_location, area.radius_km)).maybeSingle())?.state;
    const links = await fetchAllRows((from, to) => db.from("account_event_areas").select("event_id").eq("collection_area_id", area.id).order("event_id").range(from, to));
    const ids = links.map(link => link.event_id);
    const [events, decisions, sources, scores] = await Promise.all([
      fetchInBatches(ids, batch => db.from("events").select("*").in("id", batch)),
      fetchInBatches(ids, batch => db.from("account_events").select("*").eq("account_id", hotel.account_id).in("event_id", batch)),
      fetchInBatches(ids, batch => db.from("event_sources").select("*").in("event_id", batch)),
      fetchInBatches(ids, batch => db.from("hotel_event_scores").select("*").eq("hotel_id", hotel.id).in("event_id", batch)),
    ]);
    const traces = (market?.leads ?? []).flatMap(lead => [{ title: lead.title, stage: lead.pendingStage ?? "discovered", reason: lead.notes?.join("; ") },
      ...lead.editions.map(event => ({ title: event.title, start: event.startAt, end: event.endAt, stage: lead.pendingStage ?? "extracted", reason: event.evidence?.demand?.length ? "Recorded extracted evidence" : "No recorded demand facts" }))]);
    for (const event of events) {
      const decision = decisions.find(row => row.event_id === event.id);
      const assessment = readDemandAssessment(scores.find(row => row.event_id === event.id)?.demand_assessment);
      const eventSources = sources.filter(row => row.event_id === event.id && area.enabled_sources.includes(row.provider));
      const stage = decision?.state !== "active" ? "validation" : event.latitude === null || event.longitude === null ? "location"
        : !eventSources.some(row => row.primary_source_confirmed && row.source_state === "active") ? "verification"
          : !assessment ? "not_recalculated" : ["supported", "probable"].includes(assessment.relevance) ? "calendar_filter" : "demand";
      traces.push({ title: event.title, start: event.start_at, end: event.end_at, stage, reason: decision?.review_reason ?? assessment?.reasons.join("; ") });
    }
    // Expectations cannot affect any request, extraction or publication above.
    const key = JSON.parse(readFileSync("tests/fixtures/hotel-demand-expectations.json", "utf8"));
    const result = evaluateDemandAcceptance({ expected: key.positives.filter(row => row.market === target.market), negativePatterns: key.negativePatterns,
      calendar: calendar.events, traces, complete: !jobs.length && Boolean(calendar.latestRun?.finishedAt) && !calendar.latestRun?.researchPending && !market?.publicationPending });
    const output = { market: target.market, checkedAt: new Date().toISOString(), basis: `${localEvaluation ? "live API evaluation" : "production"} calendar; no enrichment`, jobs,
      research: market?.research, cycle: { version: market?.version, finished: market?.cycle?.finished, waves: market?.cycle?.waves }, ...result };
    outputs.push(output);
    writeFileSync(resolve(root, `${target.market}-snapshot.json`), JSON.stringify({ hotel, area, events, decisions, sources, scores, market, calendar, jobs }, null, 2));
    console.log(JSON.stringify({ market: target.market, status: result.status, recall: `${result.positiveRecall}/${result.expectedPositives}`, falsePositives: result.falsePositives,
      missing: result.positives.filter(row => !row.found).map(row => ({ title: row.title, stage: row.stage })) }, null, 2));
  }
  writeFileSync(resolve(root, "production-report.json"), JSON.stringify(outputs, null, 2));
  process.exitCode = outputs.every(output => output.passed) ? 0 : 2;
} finally { globalThis.fetch = originalFetch; await server.close(); }

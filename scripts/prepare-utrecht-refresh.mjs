// Make the Test utrecht area ready for one clean production refresh.
//
// Removes only state that a defect created or that would replay stale model output:
//   1. the stuck job, so `enqueueCollectionAreas` stops skipping the area
//   2. the cached near-term Claude result, which otherwise replays a run whose impactPoints the
//      old collector nulled before persisting
//   3. stale Anthropic batch-cache rows for this area's window, so a new run submits new work
//      instead of attaching to a batch created under the old prompt
//   4. long-range leads whose only fetch target is a ticket vendor or provider API and which have
//      produced no edition: created by the seed defect, they can only 403 while consuming a slot
//   5. retrieval failures for those same hosts
//
// The research cycle reopens by itself: the stored state has version 0 and monitoringVersion 2,
// so `collectLongRange` rebuilds the cycle and re-dates every lead on the next invocation.
// Nothing here deletes events, decisions, scores or evidence. Pass --apply to write.
import { readFileSync } from "node:fs";

const apply = process.argv.includes("--apply");
const AREA = "2e41b858-7902-4f2e-b3bd-14690a5f15d3";
const AGGREGATOR = /(^|\.)(ticketmaster\.(nl|com)|openholidaysapi\.org|api\.predicthq\.com|app\.ticketmaster\.com|api\.football-data\.org|feverup\.com|thisiseindhoven\.com|eventbrite\.(nl|com))$/i;

const env = Object.fromEntries(readFileSync(".env.production.local", "utf8").split("\n")
  .filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]));
const call = async (path, method = "GET", body) => {
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json", Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
};
const aggregator = (url) => {
  try { return AGGREGATOR.test(new URL(url).hostname.replace(/^www\./, "")); } catch { return true; }
};
const step = (label, detail) => console.log(`${apply ? "APPLIED " : "PLANNED "} ${label}${detail ? ` — ${detail}` : ""}`);

const [area] = await call(`collection_areas?id=eq.${AREA}&select=id,name,account_id,search_location,radius_km`);
console.log(`${area.name} (${area.search_location}, ${area.radius_km} km)\n`);

// 1. Stuck job. `processCollectionJob` only stops redelivering on succeeded/partial/skipped, so
// `failed` lets the queue resurrect the job on its next delivery. `skipped` is the terminal
// status that means "this delivery did no work", which is exactly true here.
const jobs = await call(`collection_jobs?collection_area_id=eq.${AREA}&status=in.(queued,running)&select=id,status,started_at,pending_since`);
let cutoff = Date.now();
for (const job of jobs) {
  step("stop stuck job", `${job.id.slice(0, 8)} status=${job.status} started=${job.started_at?.slice(11, 19) ?? "-"}`);
  if (job.started_at) cutoff = Math.min(cutoff, Date.parse(job.started_at));
  if (apply) {
    await call(`collection_jobs?id=eq.${job.id}`, "PATCH", { status: "skipped", pending_since: null,
      finished_at: new Date().toISOString(), error_summary: "Handmatig gestopt: opnieuw gestart met herstelde impactPoints-prompt." });
  }
}
// Any run row this job left open would otherwise keep the area looking busy.
const openRuns = await call(`collection_runs?collection_area_id=eq.${AREA}&finished_at=is.null&select=id,started_at`);
for (const run of openRuns) {
  step("close open run", run.id.slice(0, 8));
  if (apply) {
    await call(`collection_runs?id=eq.${run.id}`, "PATCH", { finished_at: new Date().toISOString(),
      error_summary: "Handmatig afgesloten voor een schone herstart." });
  }
}

// 2. Cached near-term Claude result for this location.
const cached = await call(`claude_market_cache?search_location=eq.${encodeURIComponent(area.search_location)}&select=cache_key,window_start,window_end,created_at`);
for (const row of cached) {
  step("drop cached near-term result", `${row.window_start}..${row.window_end} created ${row.created_at.slice(0, 19)}`);
  if (apply) await call(`claude_market_cache?cache_key=eq.${row.cache_key}`, "DELETE");
}

// 3. Batch-cache rows still processing, plus the Anthropic batches behind them. Their manifests
// were built under the prompt that returned `impactPoints: null`, so their output cannot produce
// a publishable grade. Only rows created after this area's job started are touched, which leaves
// another hotel's in-flight batches alone.
const batches = await call("anthropic_batch_cache?status=in.(creating,processing)&select=cache_key,batch_id,status,created_at");
const areaBatches = batches.filter((row) => Date.parse(row.created_at) >= cutoff);
const anthropicKey = readFileSync(".env.local", "utf8").split("\n")
  .find((line) => line.startsWith("ANTHROPIC_API_KEY="))?.slice("ANTHROPIC_API_KEY=".length).trim();
for (const row of areaBatches) {
  step("drop stale batch-cache row", `${row.batch_id ?? "(uncreated)"} ${row.status} ${row.created_at.slice(11, 19)}`);
  if (!apply) continue;
  await call(`anthropic_batch_cache?cache_key=eq.${row.cache_key}`, "DELETE");
  // Deleting the row only orphans the batch. Cancelling stops Anthropic billing the remainder.
  if (row.batch_id && anthropicKey) {
    const response = await fetch(`https://api.anthropic.com/v1/messages/batches/${row.batch_id}/cancel`,
      { method: "POST", headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" } });
    step("cancel anthropic batch", `${row.batch_id} -> ${response.status}`);
  }
}

// 4 and 5. Long-range leads created by the seed defect.
const markets = await call("long_range_markets?select=market_key,state,lease_owner");
const market = markets.find((row) => row.state?.leads?.some((lead) =>
  /utrecht/i.test(lead.title) || /utrecht/i.test(lead.url ?? "")) && row.state.cycle?.startedAt);
if (!market) throw new Error("Utrecht market state not found");
const state = market.state;
if (market.lease_owner) throw new Error(`market is leased by ${market.lease_owner}; wait for that worker`);

const doomed = state.leads.filter((lead) => {
  const targets = [lead.url, lead.officialPage, ...(lead.officialPages ?? [])].filter(Boolean);
  return targets.length > 0 && targets.every(aggregator) && !(lead.editions?.length);
});
console.log("");
for (const lead of doomed) step("remove unfetchable lead", `${lead.title} -> ${lead.url ?? lead.officialPage}`);
const failures = Object.keys(state.retrievalFailures ?? {}).filter(aggregator);
for (const url of failures) step("clear retrieval failure", url.slice(0, 80));

if (apply && (doomed.length || failures.length)) {
  const doomedKeys = new Set(doomed.map((lead) => lead.key));
  const next = {
    ...state,
    leads: state.leads.filter((lead) => !doomedKeys.has(lead.key)),
    retrievalFailures: Object.fromEntries(Object.entries(state.retrievalFailures ?? {}).filter(([url]) => !aggregator(url))),
    cycle: { ...state.cycle, queued: (state.cycle.queued ?? []).filter((job) => !doomedKeys.has(job.leadKey)),
      leadKeys: (state.cycle.leadKeys ?? []).filter((key) => !doomedKeys.has(key)) },
  };
  await call(`long_range_markets?market_key=eq.${market.market_key}`, "PATCH", { state: next });
}

console.log(`\nleads ${state.leads.length} -> ${state.leads.length - doomed.length}`);
console.log(`cycle: version=${state.version} monitoringVersion=${state.cycle.monitoringVersion} waves=${state.cycle.waves} finished=${state.cycle.finished}`);
console.log("  the next run rebuilds this cycle: state.version and monitoringVersion are both behind the code.");
console.log(`budget ${state.budget?.month}: ${state.budget?.spentEur?.toFixed(2)} EUR spent, ledger deliberately preserved`);
if (!apply) console.log("\nDry run. Re-run with --apply to write.");

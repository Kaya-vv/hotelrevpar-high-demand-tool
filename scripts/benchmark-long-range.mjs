import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createServer } from "vite";
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";

const { values } = parseArgs({ options: {
  "allow-paid": { type: "boolean", default: false },
  runs: { type: "string", default: "2" },
  output: { type: "string", default: "refs/long-range-benchmark" },
  city: { type: "string", default: "Eindhoven" },
  radius: { type: "string", default: "25" },
  resume: { type: "boolean", default: false },
} });
if (!values["allow-paid"]) throw new Error("Paid API calls are disabled. Use scripts/audit-long-range.mjs for an offline audit. Only pass --allow-paid after agreeing a trial budget; this flag is not a dollar cap.");
if (!Number.isInteger(Number(values.runs)) || Number(values.runs) < 1 || Number(values.runs) > 2) throw new Error("--runs must be 1 or 2");
process.loadEnvFile(".env.local");
await mkdir(values.output, { recursive: true });
const day = 86_400_000;
// Production runs one full sweep every 28 days, so a single pass is not the unit that decides
// recall: the trial's two biggest misses were leads deferred to a later pass. The +7d pass in
// between must cost nothing.
// A cold start already paid for does not need repeating, so --resume continues the saved state
// through the later sweeps instead.
const passes = [
  { label: "sweep-1", offsetDays: 0, expectRequests: "some" },
  { label: "between", offsetDays: 7, expectRequests: "none" },
  { label: "sweep-2", offsetDays: 28, expectRequests: "some" },
  { label: "sweep-3", offsetDays: 56, expectRequests: "some" },
].filter((pass) => !values.resume || pass.offsetDays >= 28);
const server = await createServer({ configFile: false, server: { middlewareMode: true }, resolve: { alias: { "@": resolve("src") } } });
try {
  const collectorHash = createHash("sha256").update(await readFile("src/features/collection/sources/long-range.ts")).digest("hex");
  const { collectLongRange } = await server.ssrLoadModule("/src/features/collection/sources/long-range.ts");
  const { longRangeWindow } = await server.ssrLoadModule("/src/features/collection/sources/claude.ts");
  const { collectionWindow, selectLongRangeSeeds } = await server.ssrLoadModule("/src/features/collection/run.ts");
  const window = longRangeWindow(collectionWindow());
  // Robert's case is an edition this account already owns, so the benchmark feeds the collector the
  // same seeds production would: confirmed Claude sources in the requested city's areas.
  const seeds = await loadSeeds(selectLongRangeSeeds);
  console.log(`Portfolio seeds: ${seeds.length}${seeds.length ? ` (${seeds.map((seed) => `${seed.title} ended ${seed.lastEditionEnd}`).join("; ")})` : ""}`);
  for (let run = 1; run <= Number(values.runs); run++) {
    let state = values.resume ? JSON.parse(await readFile(`${values.output}/cold-${run}-state.json`, "utf8")) : null;
    const usage = [];
    let acquired = false;
    const store = {
      acquire: async () => { if (acquired) return false; acquired = true; return true; },
      release: async () => { acquired = false; },
      load: async () => state ? structuredClone(state) : null,
      save: async (_key, next) => {
        state = structuredClone(next);
        await writeFile(`${values.output}/cold-${run}-state.json`, JSON.stringify(state, null, 2));
      },
    };
    const started = Date.now();
    const input = { ...window, location: values.city, radiusKm: Number(values.radius), store, seeds,
      client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }), batching: { enabled: false },
      onUsage: async (event) => {
        usage.push(event);
        await writeFile(`${values.output}/cold-${run}-usage.json`, JSON.stringify(usage, null, 2));
      },
    };
    console.log(`Cold run ${run}: ${values.city}, ${window.start} through ${window.end}`);
    const results = [];
    for (const pass of passes) {
      const result = await collectLongRange({ ...input, now: new Date(started + pass.offsetDays * day) });
      results.push({ pass: pass.label, result });
      console.log(JSON.stringify({ pass: pass.label, requests: result.requests,
        fetches: (result.usage.fetchRequests ?? 0) + (result.usage.deepRequests ?? 0),
        resolutions: result.usage.resolveRequests ?? 0,
        searches: result.usage.completedSearches ?? 0,
        estimatedCostUsd: Number((result.usage.estimatedCostUsd ?? 0).toFixed(4)),
        cacheWriteTokens: result.usage.cacheWriteTokens ?? 0, cacheReadTokens: result.usage.cacheReadTokens ?? 0,
        datesConfirmed: result.usage.datesConfirmed, backlog: result.usage.budgetDeferred }));
      if (pass.expectRequests === "none" && result.requests !== 0) {
        console.error(`Cadence violated: the ${pass.label} pass made ${result.requests} requests (sweep=${result.usage.sweep}, searches=${result.usage.completedSearches ?? 0}).`);
        process.exitCode = 1;
      }
    }
    // The benchmark is deliberately loaded only AFTER discovery completes.
    const fixture = JSON.parse(await readFile("tests/fixtures/eindhoven-long-range-benchmark.json", "utf8"));
    if (fixture.city !== values.city || fixture.radiusKm !== Number(values.radius)) throw new Error("Benchmark scope does not match the requested market");
    // A lead confirmed in sweep 1 is not re-fetched in sweep 3, so recall is the union of passes.
    const allCandidates = [...new Map(results.flatMap(({ result }) => result.candidates)
      .map((candidate) => [candidate.providerEventId, candidate])).values()];
    const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const comparisons = fixture.events.map((expected) => {
      const names = [expected.title, ...(expected.aliases ?? [])].map(normalize);
      const matches = (title) => names.some((name) => normalize(title).includes(name));
      const candidates = allCandidates.filter((candidate) => matches(candidate.title));
      const dated = candidates.filter((candidate) => candidate.startAt.slice(0, 10) === expected.start && candidate.endAt.slice(0, 10) === expected.end);
      const host = new URL(expected.officialUrl).hostname.replace(/^(www|site)\./, "");
      // A calendar hub often carries the same edition as the organiser's own site, so score the best
      // of the correctly dated candidates rather than whichever one happens to come first.
      const correct = dated.find((candidate) => candidate.primarySourceConfirmed && candidate.sourceState === "active"
        && (new URL(candidate.sourceUrl).hostname === host || new URL(candidate.sourceUrl).hostname.endsWith(`.${host}`)));
      const leads = state.leads.filter((lead) => matches(lead.title));
      return { title: expected.title, datesCorrect: dated.length > 0, officialEvidence: Boolean(correct), passed: Boolean(correct),
        sources: dated.map((candidate) => candidate.sourceUrl),
        stage: correct ? "confirmed" : dated.length ? "evidence" : candidates.length ? "dates" : leads.length ? "verification" : "discovery",
        leadNotes: leads.map((lead) => ({ title: lead.title, outcome: lead.outcome, origin: lead.origin, anchor: lead.anchor, attempts: lead.attempts, notes: lead.notes })),
      };
    });
    const totalCostUsd = results.reduce((sum, { result }) => sum + (result.usage.estimatedCostUsd ?? 0), 0);
    const spend = { perPass: results.map(({ pass, result }) => ({ pass, requests: result.requests, estimatedCostUsd: Number((result.usage.estimatedCostUsd ?? 0).toFixed(4)) })),
      totalCostUsd: Number(totalCostUsd.toFixed(4)),
      // Production runs through the Batches API at half price; the benchmark keeps batching off for latency.
      batchedCostUsd: Number((totalCostUsd / 2).toFixed(4)) };
    const report = { window, collectorHash, model: process.env.ANTHROPIC_MODEL, discoveryModel: process.env.ANTHROPIC_DISCOVERY_MODEL ?? process.env.ANTHROPIC_MODEL,
      resolutionModel: process.env.ANTHROPIC_TRIAGE_MODEL ?? "claude-haiku-4-5-20251001",
      capturedAt: new Date().toISOString(), spend, passes: results, comparisons };
    await writeFile(`${values.output}/cold-${run}.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ run, passed: comparisons.filter((item) => item.passed).length, total: comparisons.length, spend, comparisons }));
    // A second hotel in the same market must reuse the shared state without AI calls.
    const warm = await collectLongRange({ ...input, now: new Date(started + 56 * day) });
    await writeFile(`${values.output}/warm-${run}.json`, JSON.stringify(warm, null, 2));
    console.log(`Warm run ${run}: ${warm.requests} requests, ${warm.usage.inputTokens} input tokens; backlog ${warm.usage.budgetDeferred}`);
    const coldCost = values.resume ? 0 : results[0].result.usage.estimatedCostUsd ?? 0;
    const laterCost = Math.max(...results.slice(values.resume ? 0 : 1).map(({ result }) => result.usage.estimatedCostUsd ?? 0));
    if (coldCost > 2.6 || laterCost > 1.1) {
      console.error(`Budget exceeded: cold sweep $${coldCost.toFixed(2)} (max 2.60), worst later pass $${laterCost.toFixed(2)} (max 1.10).`);
      process.exitCode = 1;
    }
    if (comparisons.some((item) => !item.passed) || results.some(({ result }) => result.error) || warm.requests !== 0) process.exitCode = 1;
  }
} finally {
  await server.close();
}

// Seeds accelerate Robert's case but are not a dependency of the recall measurement, so an
// unreachable or empty database degrades to a seedless run instead of aborting the benchmark.
async function loadSeeds(selectLongRangeSeeds) {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: areas, error: areaError } = await supabase.from("collection_areas").select("id").ilike("search_location", `%${values.city}%`);
  if (areaError) {
    console.warn(`Portfolio seeds unavailable: ${areaError.message}`);
    return [];
  }
  if (!areas?.length) return [];
  const { data: links, error: linkError } = await supabase.from("account_event_areas").select("event_id").in("collection_area_id", areas.map((area) => area.id));
  if (linkError) throw linkError;
  if (!links?.length) return [];
  const eventIds = [...new Set(links.map((link) => link.event_id))];
  const { data: sources, error: sourceError } = await supabase.from("event_sources")
    .select("event_id, source_url, extracted_start_at, extracted_end_at, checked_at")
    .eq("provider", "claude").eq("primary_source_confirmed", true).in("event_id", eventIds);
  if (sourceError) throw sourceError;
  const rows = selectLongRangeSeeds(sources ?? []);
  if (!rows.length) return [];
  const { data: events, error: eventError } = await supabase.from("events").select("id, title").in("id", rows.map((row) => row.eventId));
  if (eventError) throw eventError;
  return rows.flatMap((row) => {
    const title = events?.find((item) => item.id === row.eventId)?.title;
    return title ? [{ title, url: row.url, lastEditionEnd: row.lastEditionEnd }] : [];
  });
}

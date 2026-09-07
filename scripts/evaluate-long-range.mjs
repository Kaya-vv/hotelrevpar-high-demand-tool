// Isolated evaluation, optionally using a read-only portfolio snapshot; never writes production hotels.
import { mkdir, readFile, writeFile, readdir, open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { execSync, spawnSync } from "node:child_process";
import { createServer } from "vite";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
const root = "refs/research-evaluation";
await mkdir(root, { recursive: true });
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2));
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
function run(command, env = {}) {
  const result = spawnSync(command, { shell: true, stdio: "inherit", env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`Gate failed: ${command}`);
}
const hash = createHash("sha256");
async function visit(dir) {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await visit(path);
    else { hash.update(path); hash.update(await readFile(path)); }
  }
}
for (const dir of ["src", "tests/fixtures", "supabase/migrations", "scripts"]) await visit(dir);
const digest = hash.digest("hex");
if (process.argv.includes("--offline")) {
  run(`${npx} tsc --noEmit`);
  run(`${npx} eslint src scripts/evaluate-long-range.mjs scripts/capture-long-range-evidence.mjs scripts/test-research-database.mjs scripts/capture-research-locations.mjs`);
  run(`${npx} vitest run --reporter=json --outputFile=${root}/offline-tests.json`);
  run("node scripts/test-research-database.mjs");
  const tests = JSON.parse(await readFile(`${root}/offline-tests.json`, "utf8"));
  await save(`${root}/offline-gate.json`, { digest, checkedAt: new Date().toISOString(), testsPassed: tests.numPassedTests, databaseReplay: true, syntheticResponsesProveRulesOnly: true });
  console.log("Offline gates passed. Live discovery quality remains unmeasured.");
} else {
  if (!process.argv.includes("--allow-paid")) throw new Error("Run --offline first; --allow-paid enforces the agreed USD 30 evaluation ceiling.");
  const gate = JSON.parse(await readFile(`${root}/offline-gate.json`, "utf8"));
  if (gate.digest !== digest) throw new Error("Code or evidence changed since the offline gate");
  const status = JSON.parse(execSync(`${npx} supabase status --workdir refs/research-db -o json`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  if (status.API_URL !== "http://127.0.0.1:54421") throw new Error("Local isolated Supabase required");
  const db = createClient(status.API_URL, status.SERVICE_ROLE_KEY);
  const { count, error } = await db.from("events").select("id", { count: "exact", head: true });
  if (error || count) throw new Error("The isolated event database must be empty before live evaluation");
  // User authorized continued diagnosed retries up to USD 30 total; retained ledgers enforce that cap.
  const retry = process.argv.includes("--retry-failed");
  if (retry) {
    const previous = JSON.parse(await readFile(`${root}/stopped.json`, "utf8"));
    await save(`${root}/stopped-${previous.digest}.json`, previous);
  }
  else { const lock = await open(`${root}/evaluation-started.lock`, "wx"); await lock.close(); }
  const active = await open(`${root}/active.lock`, "wx");
  await active.close();
  process.loadEnvFile(".env.local");
  process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });
  const server = await createServer({ configFile: false, logLevel: "error", server: { middlewareMode: true }, resolve: { alias: { "@": resolve("src") } } });
  const states = new Map(), reports = [];
  try {
    const storedFiles = (await readdir(root)).filter((file) => file.endsWith("-state.json"));
    for (const file of storedFiles) states.set(file.slice(0, -11), JSON.parse(await readFile(`${root}/${file}`, "utf8")));
    const attempt = retry ? Date.now().toString() : "initial";
    const { collectLongRange } = await server.ssrLoadModule("/src/features/collection/sources/long-range.ts");
    const { fetchOfficialPage } = await server.ssrLoadModule("/src/features/collection/official-pages.ts");
    const { localParts, normalizeText, eventLocalDate } = await server.ssrLoadModule("/src/features/events/normalize.ts");
    const { geocodeVenue } = await server.ssrLoadModule("/src/features/collection/sources/claude.ts");
    const { createBatchStore } = await server.ssrLoadModule("/src/features/collection/anthropic-batches.ts");
    const { selectLongRangeSeeds } = await server.ssrLoadModule("/src/features/collection/run.ts");
    const { readEventEvidence } = await server.ssrLoadModule("/src/features/events/evidence.ts");
    const batchEnabled = process.argv.includes("--batch");
    const portfolioOnly = process.argv.includes("--portfolio-only");
    const { geocodeCity } = await server.ssrLoadModule("/src/features/collection/research-location.ts");
    const benchmark = JSON.parse(await readFile("tests/fixtures/long-range-benchmark.json", "utf8"));
    const snapshotPath = process.argv.find((arg) => arg.startsWith("--warm-snapshot="))?.slice(16);
    const snapshot = snapshotPath ? JSON.parse(await readFile(snapshotPath, "utf8")) : null;
    if (portfolioOnly && !snapshot) throw new Error("Portfolio-only requires a read-only snapshot");
    if (snapshot && (!snapshot.state?.leads || !snapshot.hotel?.search_location)) throw new Error("Invalid retained-market snapshot");
    const selectedCity = process.argv.find((arg) => arg.startsWith("--market="))?.slice(9);
    const markets = snapshot ? benchmark.markets.filter((market) => market.city.toLowerCase() === snapshot.hotel.search_location.toLowerCase()) : selectedCity ? benchmark.markets.filter((market) => market.city.toLowerCase() === selectedCity.toLowerCase()) : benchmark.markets;
    if (!markets.length) throw new Error("Unknown benchmark market");
    const trials = snapshot || process.argv.includes("--one-trial") ? 1 : 2;
    for (let trial = 1; trial <= trials; trial++) for (const expectedMarket of markets) {
      const { city } = expectedMarket;
      const latitude = snapshot?.hotel.latitude ?? expectedMarket.latitude;
      const longitude = snapshot?.hotel.longitude ?? expectedMarket.longitude;
      const radiusKm = snapshot?.hotel.demand_radius_km ?? expectedMarket.radiusKm;
      const market = { city, latitude, longitude, radiusKm }, id = `${attempt}-${portfolioOnly ? "portfolio-" : snapshot ? "retained-" : ""}${city.toLowerCase()}-${trial}`, output = `${root}/${id}`;
      if (snapshot) {
        const retained = portfolioOnly ? { version: snapshot.state.version, discoveredAt: null, leads: [] } : structuredClone(snapshot.state);
        // Production research history is retained; only this isolated evaluation's spend starts at zero.
        retained.budget = { month: new Date(Date.parse(snapshot.capturedAt) + 7 * 86400000).toISOString().slice(0, 7), spentEur: 0, reservations: {}, billedIds: [] };
        states.set(id, retained);
      }
      const recordings = { requests: [], pages: [], locations: [], batches: [] };
      let acquired = false;
      const store = {
        acquire: async () => { if (acquired) return false; acquired = true; return true; }, release: async () => { acquired = false; },
        load: async () => states.has(id) ? structuredClone(states.get(id)) : null,
        save: async (_key, value) => {
          states.set(id, structuredClone(value)); await save(`${output}-state.json`, value);
          const committed = [...states.values()].reduce((sum, state) => sum + (state.budget?.spentEur ?? 0) + Object.values(state.budget?.reservations ?? {}).reduce((sum, cost) => sum + cost, 0), 0);
          if (committed > 30) throw new Error("USD 30 ceiling reached before dispatch");
        },
      };
      const recordedClient = { messages: { create: async (params, options) => {
        const entry = { params, startedAt: new Date().toISOString() }; recordings.requests.push(entry);
        try { entry.response = await client.messages.create(params, options); return entry.response; }
        catch (error) { entry.error = { message: error.message, status: error.status }; throw error; }
        finally { await save(`${output}-recordings.json`, recordings); }
      } } };
      recordedClient.messages.batches = {
        create: async (params, options) => {
          const batch = await client.messages.batches.create(params, options);
          recordings.batches.push({ id: batch.id, createdAt: new Date().toISOString() });
          recordings.requests.push(...params.requests.map((request) => ({ batchId: batch.id, customId: request.custom_id, params: request.params, startedAt: new Date().toISOString() })));
          await save(`${output}-recordings.json`, recordings);
          return batch;
        },
        retrieve: (...args) => client.messages.batches.retrieve(...args),
        results: async (batchId) => {
          const decoder = await client.messages.batches.results(batchId);
          return (async function* () {
            for await (const item of decoder) {
              const entry = recordings.requests.find((request) => request.batchId === batchId && request.customId === item.custom_id);
              if (entry) { if (item.result.type === "succeeded") entry.response = item.result.message; else entry.error = item.result; }
              await save(`${output}-recordings.json`, recordings);
              yield item;
            }
          })();
        },
      };
      const batchStore = createBatchStore(db);
      // Same durable batch implementation as production, with a separate cache namespace per trial.
      const isolatedBatches = Object.fromEntries(Object.entries(batchStore).map(([name, method]) => [name, (key, ...args) => method(`${id}:${key}`, ...args)]));
      const seeds = snapshot ? selectLongRangeSeeds(snapshot.sources.filter((source) => source.primary_source_confirmed && (!portfolioOnly || (source.extracted_start_at < "2027-01-01" && (source.extracted_end_at ?? source.extracted_start_at) < "2027-01-01" && snapshot.events.some((event) => event.id === source.event_id && event.start_at < "2027-01-01" && event.end_at < "2027-01-01"))))).flatMap((row) => {
        const event = snapshot.events.find((event) => event.id === row.eventId);
        const source = snapshot.sources.filter((source) => source.event_id === row.eventId && (source.public_source_url ?? source.source_url) === row.url && (!portfolioOnly || source.extracted_start_at < "2027-01-01")).sort((a, b) => b.checked_at.localeCompare(a.checked_at))[0];
        if (!event || !source) return [];
        return [{ title: event.title, url: row.url, officialPages: [...new Set([row.url, ...snapshot.sources.filter((source) => source.event_id === row.eventId && source.primary_source_confirmed && (!portfolioOnly || (source.extracted_end_at ?? source.extracted_start_at) < "2027-01-01")).map((source) => source.public_source_url ?? source.source_url)])].filter((url) => /^https?:\/\//i.test(url)).slice(0, 4), lastEditionStart: eventLocalDate(source.extracted_start_at), lastEditionEnd: row.lastEditionEnd, historicalDemandPoints: row.historicalDemandPoints, previousLocation: { venue: event.venue, text: source.extracted_location, sourceUrl: row.url, checkedAt: source.checked_at, evidence: readEventEvidence(source.evidence) } }];
      }) : [];
      if (portfolioOnly && seeds.some((seed) => JSON.stringify(seed).includes("2027"))) throw new Error("Future-edition information leaked into the prior-year seeds");
      await save(`${output}-starting-point.json`, { mode: portfolioOnly ? "2026-portfolio-only" : snapshot ? "retained" : "seedless", seeds, state: states.get(id) ?? null });
      const location = (method, resolver) => async (query) => {
        const result = await resolver(query); recordings.locations.push({ method, query, result, checkedAt: new Date().toISOString() }); return result;
      };
      const now = snapshot ? new Date(Date.parse(snapshot.capturedAt) + 7 * 86400000) : new Date(), start = new Date(now.getTime() + 90 * 86400000).toISOString().slice(0, 10);
      // Benchmark names, URLs and expected ratings never enter these inputs.
      const otherCommitted = [...states.entries()].filter(([key]) => key !== id).reduce((sum, [, state]) => sum + (state.budget?.spentEur ?? 0) + Object.values(state.budget?.reservations ?? {}).reduce((total, value) => total + value, 0), 0);
      if (otherCommitted >= 30) throw new Error("USD 30 evaluation ceiling reached");
      const input = { start, end: `${now.getUTCFullYear() + 1}-12-31`, now, location: city, radiusKm, seeds, store, client: recordedClient, batching: { enabled: batchEnabled, store: isolatedBatches }, budgetEur: Math.min(5, 30 - otherCommitted),
        pageFetcher: async (url) => {
          try { const page = await fetchOfficialPage(url); recordings.pages.push({ requestedUrl: url, page, checkedAt: new Date().toISOString() }); return page; }
          catch (error) { recordings.pages.push({ requestedUrl: url, error: error.message }); throw error; }
        }, geocode: location("venue", geocodeVenue), geocodeCity: location("city_centroid", geocodeCity),
      };
      console.log(`${portfolioOnly ? "2026 portfolio only" : snapshot ? "Retained-state weekly" : "Seedless cold"} trial ${trial}: ${city}`);
      const result = await collectLongRange(input);
      await save(`${output}-recordings.json`, recordings); await save(`${output}-input.json`, { market, result, output, retainedSnapshot: snapshotPath ?? null, simulatedCollectionAt: now.toISOString(), liveEvidenceFetchedAt: new Date().toISOString() });
      run("node scripts/test-research-database.mjs", { RESEARCH_LIVE_RESULT: resolve(`${output}-input.json`) });
      const publication = JSON.parse(await readFile(`${output}-publication.json`, "utf8"));
      const matches = (title, expected) => [expected.title, ...(expected.aliases ?? [])].some((name) => normalizeText(title).replace(/\s/g, "").includes(normalizeText(name).replace(/\s/g, "")));
      const comparisons = expectedMarket.events.map((expected) => {
        const candidates = result.candidates.filter((event) => matches(event.title, expected));
        const dateMatches = candidates.filter((event) => localParts(event.startAt).date === expected.start && localParts(event.endAt).date === expected.end);
        const dated = dateMatches.filter((event) => event.evidence?.dateText);
        const located = dated.filter((event) => event.evidence?.locationResolution && normalizeText(event.evidence.hostCity ?? "") === normalizeText(city));
        const published = publication.calendar.some((event) => matches(event.title, expected) && localParts(event.startAt).date === expected.start && localParts(event.endAt).date === expected.end);
        const leads = states.get(id).leads.filter((lead) => matches(lead.title, expected));
        return { title: expected.title, importance: expected.expectedImportance, datesCorrect: dateMatches.length > 0, datesVerified: dated.length > 0, locationCorrect: located.length > 0, published,
          stage: published ? "published" : located.length ? "demand/publication" : dated.length ? "location" : dateMatches.length ? "date evidence pending" : candidates.length ? "dates" : leads.length ? "retrieval/extraction" : "discovery",
          notes: leads.map((lead) => ({ outcome: lead.outcome, pendingStage: lead.pendingStage, nextCheck: lead.nextCheck, notes: lead.notes })) };
      });
      const highs = comparisons.filter((event) => event.importance === "High"), peaks = comparisons.filter((event) => event.importance === "Peak");
      const ungradedPublished = publication.calendar.filter((event) => !expectedMarket.events.some((expected) => matches(event.title, expected) && expected.expectedImportance));
      const passed = highs.length > 0 && highs.filter((event) => event.published).length / highs.length >= 0.8 && peaks.every((event) => event.published)
        && (city !== "Eindhoven" || comparisons.slice(0, 5).every((event) => event.datesCorrect && event.locationCorrect)) && !ungradedPublished.length;
      reports.push({ market, trial, attempt, mode: portfolioOnly ? "prior-year-portfolio" : snapshot ? "retained-state-weekly-diagnostic" : "seedless-cold", billingMode: batchEnabled ? "batch" : "standard", simulatedCollectionAt: now.toISOString(), snapshotCapturedAt: snapshot?.capturedAt ?? null, passed, comparisons, ungradedPublished, usage: result.usage, benchmarkVersion: benchmark.version, digest, providerBillingReconciled: false });
      await save(`${output}-report.json`, reports.at(-1));
      await save(`${root}/report.json`, { reports, complete: false });
      if (!passed) throw new Error(`Coverage or independent-publication audit gate failed for ${city} trial ${trial}. Stopped; diagnose before the next authorized evaluation.`);
      const completedPages = Object.entries(states.get(id).pageCache ?? {}).filter(([, page]) => page.complete).map(([url]) => url);
      const requestCount = recordings.requests.length, warm = await collectLongRange(input);
      await save(`${output}-warm.json`, warm);
      if (recordings.requests.slice(requestCount).some(({ params }) => completedPages.some((url) => JSON.stringify(params.messages).includes(`PAGE URL: ${url}`)))) throw new Error(`Warm extraction cache gate failed for ${city}`);
    }
    await save(`${root}/report.json`, { reports, complete: !snapshot && !selectedCity && trials === 2, pilotCyclesObserved: 0, revControlImportVerified: false });
  } catch (error) {
    await save(`${root}/stopped.json`, { reason: error.message, stoppedAt: new Date().toISOString(), reports, digest }); throw error;
  } finally { await server.close(); await unlink(`${root}/active.lock`); }
}

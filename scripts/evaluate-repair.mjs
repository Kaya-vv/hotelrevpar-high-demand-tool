import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "vite";
import Anthropic from "@anthropic-ai/sdk";

/** Two bounded diagnostic trials. No production database credentials or batch transport. */
export async function evaluateRepair(digest) {
  if (!process.argv.includes("--allow-paid")) throw new Error("The repair trials require --allow-paid and share a USD 2 additional ceiling.");
  const root = "refs/research-evaluation", dir = `${root}/fast-repair`;
  await mkdir(dir, { recursive: true });
  const read = async (path) => JSON.parse(await readFile(path, "utf8"));
  const save = async (path, value) => writeFile(path, JSON.stringify(value, null, 2));
  const older = await Promise.all((await readdir(root)).filter((name) => name.endsWith("-state.json")).map((name) => read(`${root}/${name}`)));
  const committed = (state) => (state?.budget?.spentEur ?? 0) + Object.values(state?.budget?.reservations ?? {}).reduce((sum, cost) => sum + cost, 0);
  const ceiling = Math.min(2, 30 - older.reduce((sum, state) => sum + committed(state), 0));
  if (ceiling <= 0) throw new Error("No authorized evaluation allowance remains");
  const fixture = await read("tests/fixtures/the-match-repair.json");
  let progress;
  try { progress = await read(`${dir}/progress.json`); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (progress && !process.argv.includes("--continue")) throw new Error("A repair evaluation exists. Inspect its progress, then use --continue explicitly.");
  if (progress && progress.digest !== digest) {
    const diagnosis = process.argv.find((arg) => arg.startsWith("--diagnosis="))?.slice(12);
    if (!process.argv.includes("--retry-failed") || progress.status !== "stopped" || !diagnosis) throw new Error("Changed-code continuation requires a stopped trial, --retry-failed, and --diagnosis=reason");
    await save(`${dir}/stopped-${progress.digest}.json`, progress);
    progress.previousCommittedUsd = (progress.previousCommittedUsd ?? 0) + Object.values(progress.trials).filter((trial) => trial.status !== "passed").reduce((sum, trial) => sum + committed(trial.state), 0);
    for (const [name, trial] of Object.entries(progress.trials)) if (trial.status !== "passed") {
      trial.priorAttempts ??= [];
      trial.priorAttempts.push({ state: trial.state, digest: progress.digest, diagnosis });
      const starting = await read(`${dir}/${name}-starting-point.json`);
      trial.state = starting.state; trial.seeds = starting.seeds;
      trial.status = "running";
    }
    progress.digest = digest; progress.status = "running"; progress.diagnosis = diagnosis;
  }
  progress ??= { id: `repair-${Date.now()}`, digest, transport: "ordinary", ceilingUsd: ceiling, status: "running", trials: {} };
  process.loadEnvFile(".env.local");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });
  const server = await createServer({ configFile: false, logLevel: "error", server: { middlewareMode: true }, resolve: { alias: { "@": resolve("src") } } });
  try {
    const { collectLongRange } = await server.ssrLoadModule("/src/features/collection/sources/long-range.ts");
    const { fetchOfficialPage } = await server.ssrLoadModule("/src/features/collection/official-pages.ts");
    const { geocodeCity } = await server.ssrLoadModule("/src/features/collection/research-location.ts");
    const { geocodeVenue } = await server.ssrLoadModule("/src/features/collection/sources/claude.ts");
    for (const mode of ["retained", "2026-only"]) {
      if (progress.trials[mode]?.status === "passed") continue;
      const trial = progress.trials[mode] ??= { status: "running", startedAt: new Date().toISOString(), requests: {}, pages: [], locations: [] };
      const now = new Date(fixture.capturedAt);
      if (!trial.state) {
        const seed = structuredClone(fixture.lead.knownEdition);
        if (JSON.stringify(seed).includes("2027")) throw new Error("Future edition information leaked into the 2026 seed");
        trial.seeds = mode === "2026-only" ? [seed] : [];
        trial.state = { version: 2003, discoveredAt: now.toISOString(), announcementSearchAt: now.toISOString(), lastSweepAt: now.toISOString(), leads: mode === "retained" ? [structuredClone(fixture.lead)] : [] };
        await save(`${dir}/${mode}-starting-point.json`, { state: trial.state, seeds: trial.seeds, mode, digest });
      }
      await save(`${dir}/progress.json`, progress);
      const persist = () => save(`${dir}/progress.json`, progress);
      const store = { acquire: async () => true, release: async () => {}, load: async () => structuredClone(trial.state), save: async (_key, state) => {
        trial.state = structuredClone(state);
        await persist();
        if ((progress.previousCommittedUsd ?? 0) + Object.values(progress.trials).reduce((sum, item) => sum + committed(item.state), 0) > ceiling) throw new Error("Combined additional USD 2 limit reached before dispatch");
      } };
      const recordedClient = { messages: { create: async (params, options) => {
        const key = createHash("sha256").update(JSON.stringify(params)).digest("hex");
        const saved = trial.requests[key];
        if (saved?.response) return saved.response;
        if (saved) throw new Error("A previous ordinary request has an uncertain result; reconcile it before resubmission");
        const entry = trial.requests[key] = { params, startedAt: new Date().toISOString() };
        await persist();
        try { entry.response = await client.messages.create(params, options); return entry.response; }
        catch (error) { entry.error = { message: error.message, status: error.status }; throw error; }
        finally { entry.finishedAt = new Date().toISOString(); await persist(); }
      } } };
      const remaining = ceiling - (progress.previousCommittedUsd ?? 0) - Object.entries(progress.trials).filter(([name]) => name !== mode).reduce((sum, [, item]) => sum + committed(item.state), 0);
      const location = (method, resolver) => async (query) => {
        const cached = trial.locations.find((item) => item.method === method && item.query === query);
        if (cached) return cached.result;
        const result = await resolver(query); trial.locations.push({ method, query, result }); await persist(); return result;
      };
      const input = { now, start: "2026-12-07", end: "2027-12-31", location: "Eindhoven", radiusKm: fixture.hotel.radiusKm, seeds: trial.seeds, store, client: recordedClient, batching: { enabled: false }, budgetEur: Math.min(5, remaining),
        pageFetcher: async (url) => {
          const saved = trial.pages.find((item) => item.requestedUrl === url && item.page);
          if (saved) return saved.page;
          try { const page = await fetchOfficialPage(url); trial.pages.push({ requestedUrl: url, checkedAt: new Date().toISOString(), page }); await persist(); return page; }
          catch (error) { trial.pages.push({ requestedUrl: url, error: error.message }); await persist(); throw error; }
        }, geocode: location("venue", geocodeVenue), geocodeCity: location("city_centroid", geocodeCity),
      };
      console.log(`Ordinary-request repair trial: ${mode}; combined ceiling USD ${ceiling.toFixed(2)}`);
      trial.result = await collectLongRange(input);
      await save(`${dir}/${mode}-result.json`, trial.result);
      await persist();
      // This database test supplies the unchanged production baseline and checks real calendar/export queries.
      const publication = spawnSync("node scripts/test-research-database.mjs", { shell: true, stdio: "inherit", env: { ...process.env, RESEARCH_REPAIR_RESULT: resolve(`${dir}/${mode}-result.json`), RESEARCH_REPAIR_OUTPUT: resolve(`${dir}/${mode}`) } });
      if (publication.status !== 0) throw new Error(`Calendar/workbook gate failed for ${mode}; diagnose before spending again`);
      const before = Object.keys(trial.requests).length;
      await collectLongRange(input);
      if (Object.keys(trial.requests).length !== before) throw new Error("Unchanged complete evidence repeated model work");
      trial.status = "passed"; trial.completedAt = new Date().toISOString(); await persist();
    }
    progress.status = "passed";
    const { estimatedCostUsd } = await server.ssrLoadModule("/src/features/collection/research-budget.ts");
    const { usageEvent } = await server.ssrLoadModule("/src/features/collection/sources/claude.ts");
    const billed = new Map(Object.values(progress.trials).flatMap((trial) => Object.values(trial.requests)).filter((request) => request.response).map((request) => [request.response.id, request]));
    progress.additionalEstimatedUsd = [...billed.values()].reduce((sum, request) => sum + (estimatedCostUsd(usageEvent(request.response, "discovery_fetch", request.params.model), false) ?? 0), 0);
    progress.providerInvoiceReconciled = false;
    await save(`${dir}/progress.json`, progress);
    console.log(`Both isolated calendar/workbook gates passed; additional estimated USD ${progress.additionalEstimatedUsd.toFixed(4)}. Production batch confirmation remains required.`);
  } catch (error) {
    progress.status = "stopped"; progress.reason = error.message; progress.stoppedAt = new Date().toISOString();
    await save(`${dir}/progress.json`, progress);
    throw error;
  } finally { await server.close(); }
}

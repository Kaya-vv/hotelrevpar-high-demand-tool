import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "vite";
import { createHash } from "node:crypto";

// Reapply a recorded response to the full retained market, then publish to local Supabase.
// No provider credentials or network retrieval. This is recovery proof, not a discovery trial.
const dir = "refs/research-evaluation/fast-repair";
const captured = JSON.parse(readFileSync(`${dir}/production-latest.json`, "utf8"));
const fixture = JSON.parse(readFileSync("tests/fixtures/the-match-repair.json", "utf8"));
const batch = captured.batches.find((item) => item.batch_id === "msgbatch_01XqezHYsARBj41WL9d7Q2pT");
const message = batch.results.find((item) => item.custom_id === "request-7").result.message;
const extracted = JSON.parse(message.content.find((item) => item.type === "text").text).events[0];
let state = structuredClone(captured.market.state);
const lead = state.leads.find((item) => item.editions.some((edition) => edition.title === extracted.title && edition.sourceUrl === extracted.sourceUrl));
if (!lead || !state.pageCache[extracted.sourceUrl]?.text) throw new Error("Recorded response/page/lead identity cannot be established");
const now = new Date(state.research.completedAt);
// Explicit replay of one completed extraction. Keep other leads, editions and the spend ledger.
// Filling the already-used lead allowance prevents selecting unrelated new work in this replay.
state.cycle = { startedAt: now.toISOString(), waves: 1, leadKeys: [lead.key, ...state.leads.filter((item) => item.key !== lead.key).slice(0, 17).map((item) => item.key)], queued: [{ leadKey: lead.key, kind: "evidence", target: extracted.sourceUrl, pages: [{ url: extracted.sourceUrl, ...state.pageCache[extracted.sourceUrl] }] }] };
lead.repair = { version: 1, dueAt: now.toISOString() };
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Network disabled during production extraction replay"); };
const server = await createServer({ configFile: false, logLevel: "error", server: { middlewareMode: true }, resolve: { alias: { "@": resolve("src") } } });
let calls = 0;
try {
  const { collectLongRange } = await server.ssrLoadModule("/src/features/collection/sources/long-range.ts");
  const result = await collectLongRange({ now, start: "2026-12-07", end: "2027-12-31", location: "Eindhoven", radiusKm: fixture.hotel.radiusKm, model: message.model, batching: { enabled: false },
    store: { acquire: async () => true, release: async () => {}, load: async () => structuredClone(state), save: async (_key, value) => { state = structuredClone(value); } },
    pageFetcher: async () => { throw new Error("Replay must use the retained page"); },
    geocode: async () => { throw new Error("Unrecorded location request"); }, geocodeCity: async () => { throw new Error("Unrecorded city request"); },
    client: { messages: { create: async () => { if (++calls > 1) throw new Error("Unrecorded model request"); return structuredClone(message); } } },
  });
  const ddw = result.candidates.filter((event) => event.providerEventId === lead.editions[0].providerEventId);
  writeFileSync(`${dir}/production-replay-diagnostic.json`, JSON.stringify({ calls, result, state }, null, 2));
  if (calls !== 1 || ddw.length !== 1 || !ddw[0].primarySourceConfirmed || !ddw[0].evidence?.dateText || ddw[0].latitude === null) throw new Error(`Extraction replay failed: ${JSON.stringify(ddw)}`);
  if (JSON.stringify(state.budget) !== JSON.stringify(captured.market.state.budget)) throw new Error("Replay changed the recorded spend ledger");
  writeFileSync(`${dir}/production-replay-result.json`, JSON.stringify(result, null, 2));
  writeFileSync(`${dir}/production-replay-state.json`, JSON.stringify(state, null, 2));
  const changedFiles = execFileSync("git", ["ls-files", "--modified", "--others", "--exclude-standard"], { encoding: "utf8" }).trim().split(/\r?\n/);
  const codeFiles = Object.fromEntries(changedFiles.map((path) => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
  writeFileSync(`${dir}/production-replay.json`, JSON.stringify({ codeVersion: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), codeFiles, batchId: batch.batch_id, requestId: message.id, additionalSpend: 0, replayedRequests: calls, retainedLeads: state.leads.length, ddw, status: "extraction-passed" }, null, 2));
} finally { globalThis.fetch = originalFetch; await server.close(); }
const publication = spawnSync("node", ["scripts/test-research-database.mjs"], { stdio: "inherit", env: { ...process.env, RESEARCH_REPAIR_RESULT: resolve(`${dir}/production-replay-result.json`), RESEARCH_REPAIR_OUTPUT: resolve(`${dir}/production-replay`), RESEARCH_PRODUCTION_REPLAY: "true" } });
if (publication.status !== 0) process.exitCode = publication.status ?? 1;
else {
  const report = JSON.parse(readFileSync(`${dir}/production-replay.json`, "utf8"));
  report.status = "calendar-and-workbook-passed";
  writeFileSync(`${dir}/production-replay.json`, JSON.stringify(report, null, 2));
}


// Isolated research check. Writes local evidence only, never changes production or queues a hotel run.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createServer } from "vite";
import Anthropic from "@anthropic-ai/sdk";

const { values } = parseArgs({ options: {
  title: { type: "string" }, "allow-paid": { type: "boolean", default: false },
  output: { type: "string", default: "refs/single-lead-check" },
} });
if (!values.title) throw new Error("Supply --title for an existing series in the saved Eindhoven queue.");
const snapshot = JSON.parse(await readFile("tests/fixtures/eindhoven-queue-state.json", "utf8"));
const lead = snapshot.leads.find((item) => item.title === values.title);
if (!lead?.url) throw new Error("Known lead with an official URL required; no benchmark URL is supplied.");
await mkdir(values.output, { recursive: true });
const server = await createServer({ configFile: false, server: { middlewareMode: true }, resolve: { alias: { "@": resolve("src") } } });
try {
  const { fetchOfficialPage, retrieveOfficialPages } = await server.ssrLoadModule("/src/features/collection/official-pages.ts");
  const { collectLongRange } = await server.ssrLoadModule("/src/features/collection/sources/long-range.ts");
  const pages = new Map();
  const pageFetcher = async (url) => {
    if (!pages.has(url)) {
      const page = await fetchOfficialPage(url);
      pages.set(url, page);
      await writeFile(`${values.output}/pages.json`, JSON.stringify([...pages], null, 2));
    }
    return pages.get(url);
  };
  const now = new Date();
  const year = now.getUTCFullYear() + 1;
  const preflight = await retrieveOfficialPages(lead.url, String(year), pageFetcher);
  console.log(JSON.stringify({ fetched: preflight.pages.map((page) => page.url), errors: preflight.errors }));
  if (!values["allow-paid"]) process.exitCode = preflight.errors.length ? 1 : 0;
  else {
    process.loadEnvFile(".env.local");
    const model = process.env.ANTHROPIC_MODEL?.trim();
    if (!model) throw new Error("ANTHROPIC_MODEL required");
    const api = new Anthropic({ maxRetries: 0 });
    let calls = 0;
    const records = [];
    const client = { messages: { create: async (params, options) => {
      if (++calls > 3) throw new Error("Single-lead check's three-AI-request cap reached");
      const response = await api.messages.create(params, { ...options, maxRetries: 0 });
      records.push({ params, response });
      await writeFile(`${values.output}/recordings.json`, JSON.stringify(records, null, 2));
      return response;
    } } };
    let state = { version: 2003, discoveredAt: now.toISOString(), leads: [{ ...lead,
      nextCheck: now.toISOString(), editions: [], outcome: "pending" }] };
    const store = { acquire: async () => true, release: async () => {}, load: async () => state,
      save: async (_key, next) => { state = structuredClone(next); } };
    const result = await collectLongRange({ start: `${year}-01-01`, end: `${year}-12-31`, location: "Eindhoven", radiusKm: 25,
      now, model, client, batching: { enabled: false }, store, pageFetcher,
      geocode: async () => null });
    await writeFile(`${values.output}/result.json`, JSON.stringify({ result, state, calls }, null, 2));
    console.log(JSON.stringify({ calls, candidates: result.candidates, usage: result.usage, error: result.error }));
    if (!result.candidates.length || result.error) process.exitCode = 1;
  }
} finally { await server.close(); }

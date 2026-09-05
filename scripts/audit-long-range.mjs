// Offline only: reads saved outcomes, never loads credentials or calls providers.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  input: { type: "string", default: "refs/long-range-benchmark" },
  output: { type: "string" },
} });
const directory = resolve(values.input);
const fixture = JSON.parse(await readFile("tests/fixtures/eindhoven-long-range-benchmark.json", "utf8"));
const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const reports = [];
for (const file of (await readdir(directory)).filter((name) => /^cold-\d+\.json$/.test(name)).sort()) {
  const report = JSON.parse(await readFile(resolve(directory, file), "utf8"));
  const state = JSON.parse(await readFile(resolve(directory, file.replace(".json", "-state.json")), "utf8"));
  // A cold run is a sequence of sweeps against one state, so spend is the sum across passes.
  const usage = report.passes.reduce((totals, { result }) => {
    for (const [field, value] of Object.entries(result.usage)) totals[field] = (totals[field] ?? 0) + value;
    return totals;
  }, {});
  const comparisons = fixture.events.map((expected) => {
    const previous = report.comparisons.find((item) => item.title === expected.title);
    const names = [expected.title, ...(expected.aliases ?? [])].map(normalize);
    const leads = state.leads.filter((lead) => names.some((name) => normalize(lead.title).includes(name)));
    let stage = previous?.stage ?? "discovery";
    if (previous?.passed) stage = "confirmed";
    else if (leads.length && leads.every((lead) => !lead.checkedAt)) stage = "budget deferred";
    else if (leads.length && leads.every((lead) => !lead.url || lead.notes.some((note) => /no qualifying URL can be returned/i.test(note)))) stage = "URL resolution";
    else if (stage === "verification" || stage === "dates" || stage === "evidence") stage = "date verification";
    return { title: expected.title, stage, notes: leads.flatMap((lead) => lead.notes) };
  });
  reports.push({ file, inputTokens: usage.inputTokens, targetInputTokens: Math.floor(310323 / 2),
    estimatedCostUsd: usage.estimatedCostUsd, batchedCostUsd: report.spend?.batchedCostUsd,
    perPass: report.spend?.perPass,
    discovery: { inputTokens: usage.discovery_inputTokens, estimatedCostUsd: usage.discovery_estimatedCostUsd },
    verification: { inputTokens: usage.verification_inputTokens, estimatedCostUsd: usage.verification_estimatedCostUsd },
    comparisons });
}
if (!reports.length) throw new Error("No saved cold-run reports found");
const audit = { scope: "Saved outcomes only; not a replay of model responses or evidence of current prompt coverage. Missing named leads can also indicate an unresolved calendar source.", reports };
const json = JSON.stringify(audit, null, 2);
if (values.output) await writeFile(resolve(values.output), json);
console.log(json);

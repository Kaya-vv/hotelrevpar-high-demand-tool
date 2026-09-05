import { expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import sources from "../../../../tests/fixtures/eindhoven-queue-sources.json";
import snapshot from "../../../../tests/fixtures/eindhoven-queue-state.json";
import { selectLongRangeSeeds } from "../run";
import type { LongRangeState, LongRangeStore } from "../long-range-store";
import { collectLongRange, repairObservedUrl } from "./long-range";

// Saved production queue and public source assessments. Responses below are synthetic empty
// pages: this tests selection and routing, not live discovery or date-extraction coverage.
it.each([false, true])("selects the benchmark from the saved queue without relying on its name (renamed=%s)", async (renamed) => {
  const target = renamed ? "Independent Art Fair" : "Dutch Design Week";
  const rename = (title: string) => title.replace("Dutch Design Week", target);
  const sourceRows = sources.map((row) => ({ ...row, title: rename(row.title) }));
  const now = new Date("2026-09-05T21:00:00Z");
  const legacySeeds = selectLongRangeSeeds(sourceRows.map((row) => ({ ...row, ai_impact_points: null })), now);
  expect(legacySeeds.some((seed) => sourceRows.find((row) => row.event_id === seed.eventId)?.title.includes(target))).toBe(false);
  const selected = selectLongRangeSeeds(sourceRows, now);
  const seeds = selected.map((seed) => {
    const row = sourceRows.find((row) => row.event_id === seed.eventId && (row.public_source_url ?? row.source_url) === seed.url)!;
    return { ...seed, title: row.title, lastEditionStart: row.extracted_start_at.slice(0, 10) };
  });
  expect(seeds.some((seed) => seed.title.includes(target))).toBe(true);
  let state = structuredClone(snapshot) as unknown as LongRangeState;
  state.discoveredAt = now.toISOString();
  state.lastSweepAt = "2026-08-01T00:00:00Z";
  state.leads.forEach((lead) => { lead.nextCheck = now.toISOString(); lead.title = rename(lead.title); });
  const store: LongRangeStore = { acquire: async () => true, release: async () => {}, load: async () => state,
    save: async (_key, value) => { state = structuredClone(value); } };
  const create = vi.fn().mockImplementation(async (request) => {
    if (request.tools[0].name === "web_search") return { stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ url: null, reason: "Offline resolver fixture" }) }],
      usage: { input_tokens: 0, output_tokens: 0, server_tool_use: { web_search_requests: 1 } } };
    const prompt = request.messages[0].content[1].text as string;
    const url = prompt.split("First fetch this observed official source: ")[1].split("\n")[0];
    return { stop_reason: "end_turn", content: [
      { type: "web_fetch_tool_result", content: { type: "web_fetch_result", url } },
      { type: "text", text: JSON.stringify({ events: [], reason: "Offline old-edition fixture" }) },
    ], usage: { input_tokens: 0, output_tokens: 0, server_tool_use: { web_fetch_requests: 1 } } };
  });
  const result = await collectLongRange({ start: "2026-12-05", end: "2027-12-31", location: "Eindhoven", radiusKm: 25,
    now, seeds, store, model: "claude-sonnet-5", batching: { enabled: false },
    client: { messages: { create } } as unknown as Anthropic, geocode: async () => { throw new Error("Network disabled"); } });
  const ddwRequests = create.mock.calls.map(([request]) => JSON.stringify(request.messages)).filter((text) => text.includes(`Lead: ${target}`));
  expect(ddwRequests).toHaveLength(2);
  expect(ddwRequests[1]).toContain("Then read a SECOND page");
  expect(ddwRequests[0]).toContain("edition year(s) 2027");
  expect(result.usage.deepRequests).toBeLessThanOrEqual(8);
  expect(result.usage.resolveRequests).toBeLessThanOrEqual(6);
  expect(result.requests).toBeLessThanOrEqual(38);
  expect(result.candidates).toEqual([]);
  expect(create.mock.calls.some(([request]) => JSON.stringify(request.messages).includes("First fetch this observed official source: ozi:"))).toBe(false);
});

it("refuses non-HTTP discovery URLs even when returned by search", () => {
  expect(repairObservedUrl("ozi://organizer.example/", ["ozi://organizer.example/"])).toBeNull();
});

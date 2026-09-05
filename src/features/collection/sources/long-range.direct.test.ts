import { expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { collectLongRange } from "./long-range";
import { parseOfficialPage } from "../official-pages";
import type { LongRangeState, LongRangeStore } from "../long-range-store";

it("fetches linked pages in code and accepts only supplied page evidence, without model fetch tools", async () => {
  const now = new Date("2026-09-05T12:00:00Z");
  let state: LongRangeState = { version: 2003, discoveredAt: now.toISOString(), leads: [{
    key: "arts", title: "Annual Arts Week", url: "https://organizer.example/", kind: "event", group: 1,
    outcome: "pending", nextCheck: now.toISOString(), checkedAt: null, editions: [], notes: [],
  }] };
  const store: LongRangeStore = { acquire: async () => true, release: async () => {}, load: async () => state,
    save: async (_key, value) => { state = structuredClone(value); } };
  const pageFetcher = vi.fn(async (url: string) => parseOfficialPage(url.endsWith("/about")
    ? "Annual Arts Week, Eindhoven. Future dates: 23–31 October 2027."
    : '<a href="/about">About</a>Annual Arts Week 2026.', url));
  const create = vi.fn(async () => ({ stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 }, content: [{ type: "text", text: JSON.stringify({ events: [{
    sourceUrl: "https://organizer.example/about", title: "Annual Arts Week", category: "culture", venue: null, latitude: null, longitude: null,
    regionScope: "Eindhoven", startAt: "2027-10-23", endAt: "2027-10-31", status: "active", ownerType: "organizer",
    evidenceText: "Future dates: 23–31 October 2027", attendance: null, venueCapacity: null, impactPoints: null,
    overnightAudience: null, titleConfirmed: true, dateConfirmed: true, locationConfirmed: true,
  }], reason: "Supplied official text" }) }] }));
  const input = { start: "2027-01-01", end: "2027-12-31", location: "Eindhoven", radiusKm: 25, now, model: "claude-sonnet-5",
    client: { messages: { create } } as unknown as Anthropic, batching: { enabled: false }, pageFetcher, store };
  const result = await collectLongRange(input);
  expect(result.candidates[0]).toMatchObject({ startAt: "2027-10-23T00:00:00Z", aiImpactPoints: null });
  expect(pageFetcher).toHaveBeenCalledTimes(2);
  expect(create).toHaveBeenCalledTimes(1);
  expect((create.mock.calls as unknown[][])[0][0]).toMatchObject({ tools: [] });
  expect(state.leads[0].officialPage).toBe("https://organizer.example/about");
  expect((await collectLongRange(input)).requests).toBe(0);
  expect(pageFetcher).toHaveBeenCalledTimes(2);
});

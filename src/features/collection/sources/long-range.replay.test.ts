import { describe, expect, it } from "vitest";
import recording from "../../../../tests/fixtures/ddw-production-replay.json";
import unfetched from "../../../../tests/fixtures/ddw-unfetched-announcement-replay.json";
import { replayAnthropic, type ReplayEntry } from "../../../../tests/helpers/anthropic-replay";
import { collectLongRange } from "./long-range";
import type { LongRangeState, LongRangeStore } from "../long-range-store";

describe("saved production response replay (no network)", () => {
  it.each(["missing", "fetched", "wrong-page"])("replays the cited-but-unfetched announcement and requires an explicit fetch (%s)", async (completion) => {
    const now = new Date("2026-09-05T21:09:10Z");
    let state: LongRangeState = { version: 2003, discoveredAt: now.toISOString(), leads: [{
      key: "ddw", title: "Dutch Design Week", url: "https://ddw.nl/en", kind: "event", group: 1,
      outcome: "pending", nextCheck: now.toISOString(), checkedAt: null, editions: [], notes: [],
    }] };
    const store: LongRangeStore = { acquire: async () => true, release: async () => {}, load: async () => state,
      save: async (_key, value) => { state = structuredClone(value); } };
    const entries = structuredClone(unfetched.entries) as ReplayEntry[];
    if (completion !== "missing") {
      // Synthetic final response tests the acceptance gate, not a claim that the live fetch succeeded.
      const answer = (entries[1].message as { content: { type: string; text?: string }[] }).content.find((block) => block.type === "text")!;
      entries.push({ tool: "web_fetch", contains: "Call web_fetch on it now", message: {
        stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 },
        content: [{ type: "web_fetch_tool_result", content: { type: "web_fetch_result",
          url: completion === "fetched" ? "https://ddw.nl/en/about-ddw" : "https://ddw.nl/en" } }, answer],
      } });
    }
    const replay = replayAnthropic(entries);
    const result = await collectLongRange({ pageFetcher: false, start: "2026-12-05", end: "2027-12-31", location: "Eindhoven", radiusKm: 25,
      now, model: "claude-sonnet-5", client: replay.client, batching: { enabled: false }, store,
      geocode: async () => { throw new Error("Network disabled"); } });
    expect(replay.requests).toHaveLength(3);
    expect(JSON.stringify(replay.requests[2].messages)).toContain("First fetch this observed official source: https://ddw.nl/en/about-ddw");
    expect(replay.requests[2].tools).toHaveLength(1);
    expect(result.usage.evidenceRequests).toBe(1);
    if (completion === "fetched") {
      expect(result.candidates[0]).toMatchObject({ title: "Dutch Design Week 2027", startAt: "2027-10-23T00:00:00Z",
        endAt: "2027-10-31T23:59:59Z", aiImpactPoints: null });
      expect(state.leads[0].officialPage).toBe("https://ddw.nl/en/about-ddw");
    } else expect(result.candidates).toEqual([]);
  });

  it("replays DDW's URL resolution and old homepage, then exposes the missing deeper-page recording", async () => {
    const now = new Date("2026-09-05T19:29:55Z");
    let state: LongRangeState = { version: 2003, discoveredAt: now.toISOString(), leads: [{
      key: "ddw", title: "Dutch Design Week", url: null, kind: "event", group: 1,
      outcome: "pending", nextCheck: now.toISOString(), checkedAt: null, editions: [], notes: [],
    }] };
    const store: LongRangeStore = { acquire: async () => true, release: async () => {},
      load: async () => structuredClone(state), save: async (_key, value) => { state = structuredClone(value); } };
    const replay = replayAnthropic(recording.entries as ReplayEntry[]);
    const result = await collectLongRange({ pageFetcher: false, start: "2026-12-05", end: "2027-12-31", location: "Eindhoven", radiusKm: 25,
      now, model: "claude-sonnet-5", resolutionModel: "claude-haiku-4-5-20251001", store,
      client: replay.client, batching: { enabled: false }, geocode: async () => { throw new Error("Replay must not geocode online"); } });
    expect(replay.remaining()).toBe(0);
    expect(replay.requests).toHaveLength(3);
    expect(JSON.stringify(replay.requests[2].messages)).toContain("Then read a SECOND page");
    expect(result.error).toContain("Replay has no recorded response");
    expect(result.candidates).toEqual([]);
    expect(state.leads[0].editions).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import recording from "../../../../tests/fixtures/ddw-production-replay.json";
import { replayAnthropic, type ReplayEntry } from "../../../../tests/helpers/anthropic-replay";
import { collectLongRange } from "./long-range";
import type { LongRangeState, LongRangeStore } from "../long-range-store";

describe("saved production response replay (no network)", () => {
  it("replays DDW's URL resolution and old homepage, then exposes the missing deeper-page recording", async () => {
    const now = new Date("2026-09-05T19:29:55Z");
    let state: LongRangeState = { version: 2003, discoveredAt: now.toISOString(), leads: [{
      key: "ddw", title: "Dutch Design Week", url: null, kind: "event", group: 1,
      outcome: "pending", nextCheck: now.toISOString(), checkedAt: null, editions: [], notes: [],
    }] };
    const store: LongRangeStore = { acquire: async () => true, release: async () => {},
      load: async () => structuredClone(state), save: async (_key, value) => { state = structuredClone(value); } };
    const replay = replayAnthropic(recording.entries as ReplayEntry[]);
    const result = await collectLongRange({ start: "2026-12-05", end: "2027-12-31", location: "Eindhoven", radiusKm: 25,
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

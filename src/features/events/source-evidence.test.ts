import { describe, expect, it } from "vitest";

import { readEventEvidence } from "./evidence";
import { selectScoreEvidence } from "./source-evidence";

const evidence = {
  source_state: "active",
  primary_source_confirmed: true,
  public_source_url: "https://organizer.example/event",
  ai_impact_points: null,
  local_rank: null,
  attendance: null,
  venue_capacity: null,
  checked_at: "2026-09-01T10:00:00Z",
};

describe("score evidence selection", () => {
  it("prefers enabled confirmed AI evidence over provider popularity", () => {
    const selected = selectScoreEvidence(
      [
        {
          ...evidence,
          provider: "predicthq",
          local_rank: 100,
        },
        {
          ...evidence,
          provider: "claude",
          ai_impact_points: 45,
        },
      ],
      ["predicthq", "claude"],
    );

    expect(selected?.provider).toBe("claude");
  });

  it("returns no scoring evidence for a disabled or unconfirmed source", () => {
    expect(
      selectScoreEvidence(
        [{ ...evidence, provider: "predicthq", local_rank: 100 }],
        ["claude"],
      ),
    ).toBeUndefined();
    expect(
      selectScoreEvidence(
        [{
          ...evidence,
          provider: "claude",
          ai_impact_points: 60,
          primary_source_confirmed: false,
        }],
        ["claude"],
      ),
    ).toBeUndefined();
  });
  it("merges more than four complementary facts while excluding disabled and cancelled sources", () => {
    const facts = (prefix: string) => ({ dateText: "1-3 January 2027", locationText: "Eindhoven", hostCity: "Eindhoven", locationScope: "citywide", continuous: true, majorCompetition: false, checkedAt: evidence.checked_at, dateSourceUrl: evidence.public_source_url,
      demand: Array.from({ length: 3 }, (_, index) => ({ sourceUrl: evidence.public_source_url, text: `${prefix} ${index}`, kind: "attendance", scope: "edition", year: 2027, comparable: true })) });
    const selected = selectScoreEvidence([
      { ...evidence, provider: "claude", evidence: facts("first") },
      { ...evidence, provider: "claude", evidence: facts("second") },
      { ...evidence, provider: "claude", evidence: facts("first") },
      { ...evidence, provider: "claude", source_state: "cancelled", evidence: facts("cancelled") },
      { ...evidence, provider: "predicthq", evidence: facts("disabled") },
    ], ["claude"]);
    expect(readEventEvidence(selected?.evidence)?.demand.map(fact => fact.text)).toEqual(["first 0", "first 1", "first 2", "second 0", "second 1", "second 2"]);
  });

});

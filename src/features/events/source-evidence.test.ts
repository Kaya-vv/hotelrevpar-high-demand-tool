import { describe, expect, it } from "vitest";

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
});

import { describe, expect, it } from "vitest";
import { estimatedCostUsd } from "./research-budget";
import { LUNA_FAST_MODEL, LUNA_MODEL } from "./luna-client";

describe("research cost", () => {
  it.each([LUNA_MODEL, LUNA_FAST_MODEL])("prices a %s request at Luna's standard rates", (model) => {
    const cost = estimatedCostUsd({ phase: "discovery", model, inputTokens: 7_500, outputTokens: 2_100, webSearchRequests: 3, webFetchRequests: 0 }, false);
    // 7,500 x $0.10/M = $0.00075 input, 2,100 x $0.50/M = $0.00105 output, three searches at $0.01.
    expect(cost).toBeCloseTo(0.0318, 8);
  });
});

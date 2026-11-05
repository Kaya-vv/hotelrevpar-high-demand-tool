import { describe, expect, it } from "vitest";

import { automatedExclusionReason } from "./decision-state";

describe("automatedExclusionReason", () => {
  it("records a reason for every automated exclusion so later evidence can reverse it", () => {
    // Production: the Marathon verified on its official page yet stayed excluded, because
    // missing_primary_evidence wrote a null reason and read back as a human decision.
    expect(automatedExclusionReason("excluded", "missing_primary_evidence", false))
      .toBe("missing_primary_evidence");
    expect(automatedExclusionReason("excluded", "cancelled", false)).toBe("provider_cancelled");
    expect(automatedExclusionReason("excluded", "out_of_window", false)).toBe("out_of_window");

    // A human exclusion stays sticky, and an active decision carries no reason.
    expect(automatedExclusionReason("excluded", "missing_primary_evidence", true)).toBeNull();
    expect(automatedExclusionReason("active", null, false)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { currentSourceError } from "./source-health-state";

describe("source health errors", () => {
  it("does not show an interruption error for a successful source", () => {
    expect(currentSourceError({ state: "success" }, "2026-08-29T13:48:03Z")).toBeNull();
  });

  it("shows the fallback only when a finished run never recorded the source", () => {
    expect(currentSourceError(undefined, "2026-08-29T13:48:03Z")).toBe("Run stopte voordat deze bron verwerkt kon worden.");
  });
});

import { describe, expect, it } from "vitest";

import { summarizeBatch } from "./query";

describe("summarizeBatch", () => {
  it("stops polling a failed batch", () => {
    expect(summarizeBatch("batch-1", [{ status: "failed" }])).toEqual({
      batchId: "batch-1",
      total: 1,
      completed: 0,
      failed: 1,
      active: false,
    });
  });

  it("keeps polling queued and running jobs", () => {
    expect(summarizeBatch("batch-1", [{ status: "succeeded" }, { status: "running" }])).toMatchObject({
      completed: 1,
      active: true,
    });
  });
});

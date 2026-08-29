import { describe, expect, it, vi } from "vitest";

import { fetchInBatches } from "./fetch-in-batches";

describe("fetchInBatches", () => {
  it("deduplicates and limits each URL filter to fifty values", async () => {
    const values = [...Array.from({ length: 105 }, (_, index) => `id-${index}`), "id-0"];
    const fetch = vi.fn(async (batch: string[]) => ({ data: batch, error: null }));

    await expect(fetchInBatches(values, fetch)).resolves.toEqual(values.slice(0, 105));
    expect(fetch.mock.calls.map(([batch]) => batch.length)).toEqual([50, 50, 5]);
  });
});

import { describe, expect, it, vi } from "vitest";

import { fetchAllRows, fetchInBatches } from "./fetch-in-batches";

describe("fetchInBatches", () => {
  it("does not truncate annual export history at the server row limit", async () => {
    const values = Array.from({ length: 1001 }, (_, index) => index);
    const fetch = vi.fn(async (from: number, to: number) => ({ data: values.slice(from, to + 1), error: null }));
    expect(await fetchAllRows(fetch)).toEqual(values);
    expect(fetch).toHaveBeenCalledTimes(3);
    await expect(fetchAllRows(async () => ({ data: null, error: new Error("Database unavailable") }))).rejects.toThrow("Database unavailable");
  });
  it("deduplicates and limits each URL filter to fifty values", async () => {
    const values = [...Array.from({ length: 105 }, (_, index) => `id-${index}`), "id-0"];
    const fetch = vi.fn(async (batch: string[]) => ({ data: batch, error: null }));

    await expect(fetchInBatches(values, fetch)).resolves.toEqual(values.slice(0, 105));
    expect(fetch.mock.calls.map(([batch]) => batch.length)).toEqual([50, 50, 5]);
  });
});

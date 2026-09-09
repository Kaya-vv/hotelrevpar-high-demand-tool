import { describe, expect, it, vi } from "vitest";

import { fetchAllRows, fetchInBatches, fetchPagedInBatches } from "./fetch-in-batches";

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

it("bounds concurrent batch requests while retaining input order", async () => {
  let active = 0, peak = 0;
  const ids = Array.from({ length: 601 }, (_, i) => String(i));
  const result = await fetchInBatches(ids, async batch => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--; return { data: batch, error: null };
  });
  expect(result).toEqual(ids);
  expect(peak).toBe(4);
});
it("exhausts more than a thousand child rows within one ID batch", async () => {
  const rows = Array.from({ length: 1201 }, (_, i) => i);
  const result = await fetchPagedInBatches(["one-event"], async (_ids, from, to) => ({ data: rows.slice(from, to + 1), error: null }));
  expect(result).toEqual(rows);
});

type BatchResult<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

/** Exhaust a deterministically ordered query instead of silently accepting the API row cap. */
export async function fetchAllRows<T>(fetch: (from: number, to: number) => BatchResult<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const result = await fetch(from, from + 499);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < 500) return rows;
  }
}

export async function fetchInBatches<T>(
  values: string[],
  fetch: (batch: string[]) => BatchResult<T>,
): Promise<T[]> {
  const unique = [...new Set(values)];
  const batches = Array.from({ length: Math.ceil(unique.length / 50) }, (_, index) => unique.slice(index * 50, index * 50 + 50));
  const rows: T[] = [];
  // A year of events used to launch every REST request simultaneously.
  for (let start = 0; start < batches.length; start += 4) {
    const results = await Promise.all(batches.slice(start, start + 4).map(async (batch) => {
      const result = await fetch(batch);
      if (result.error) throw result.error;
      return result.data ?? [];
    }));
    rows.push(...results.flat());
  }
  return rows;
}

/** One input ID can have many rows; exhaust each batch, not just its first API page. */
export function fetchPagedInBatches<T>(values: string[], fetch: (ids: string[], from: number, to: number) => BatchResult<T>) {
  return fetchInBatches(values, async ids => ({ data: await fetchAllRows((from, to) => fetch(ids, from, to)), error: null }));
}

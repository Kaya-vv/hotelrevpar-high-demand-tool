type BatchResult<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

export async function fetchInBatches<T>(
  values: string[],
  fetch: (batch: string[]) => BatchResult<T>,
): Promise<T[]> {
  const unique = [...new Set(values)];
  const batches = Array.from({ length: Math.ceil(unique.length / 50) }, (_, index) => unique.slice(index * 50, index * 50 + 50));
  const results = await Promise.all(batches.map(async (batch) => {
    const result = await fetch(batch);
    if (result.error) throw result.error;
    return result.data ?? [];
  }));
  return results.flat();
}

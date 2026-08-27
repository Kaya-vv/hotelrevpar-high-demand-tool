import { z } from "zod";

import type { Fetcher } from "./types";

export async function fetchJson<T>(
  url: string | URL,
  schema: z.ZodType<T>,
  fetcher: Fetcher = fetch,
  init: RequestInit = {},
) {
  const response = await fetcher(url, { ...init, signal: init.signal ?? AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return schema.parse(await response.json());
}


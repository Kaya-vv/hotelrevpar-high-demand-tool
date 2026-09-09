import { fetchAllRows, fetchInBatches } from "@/lib/supabase/fetch-in-batches";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";

// UI readers need status, never the saved prompts, pages and editions in state.
export const MARKET_STATUS_COLUMNS =
  "market_key, publishedAt:state->>publishedAt, publicationPending:state->publicationPending, research:state->research, waves:state->cycle->waves, leadKeys:state->cycle->leadKeys";

export const getMarketStatuses = cache(async () => {
  return fetchAllRows((from, to) =>
    createAdminClient()
      .from("long_range_markets")
      .select(MARKET_STATUS_COLUMNS)
      .order("market_key")
      .range(from, to),
  );
});

export async function getMarketProgress(keys: string[]) {
  const rows = await fetchInBatches(keys, (ids) =>
    createAdminClient()
      .from("long_range_markets")
      .select(
        "market_key, publishedAt:state->>publishedAt, publicationPending:state->publicationPending, requestedAt:state->research->>requestedAt",
      )
      .in("market_key", ids),
  );
  return new Map(
    rows.map((row) => [
      row.market_key,
      {
        publishedAt: row.publishedAt ?? undefined,
        publicationPending: row.publicationPending === true,
        research: row.requestedAt
          ? { requestedAt: row.requestedAt }
          : undefined,
      },
    ]),
  );
}

export async function getMarketStatus(key: string) {
  return (await getMarketProgress([key])).get(key) ?? null;
}

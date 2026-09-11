import { fetchAllRows, fetchInBatches } from "@/lib/supabase/fetch-in-batches";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";

import { coveringMarket, longRangeMarketKey } from "./long-range-store";

// UI readers need status, never the saved prompts, pages and editions in state. City and radius
// come from the market itself so a hotel riding a wider market still shows that market's progress.
export const MARKET_STATUS_COLUMNS =
  "market_key, search_location, radius_km, publishedAt:state->>publishedAt, publicationPending:state->publicationPending, research:state->research, waves:state->cycle->waves, leadKeys:state->cycle->leadKeys";

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
        "market_key, search_location, radius_km, publishedAt:state->>publishedAt, publicationPending:state->publicationPending, requestedAt:state->research->>requestedAt",
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
/**
 * Resolves the market key a hotel's progress should be read from, once a wider market in the same
 * city can cover it. Loads every market once so a page with many hotels stays one round trip.
 */
export async function marketKeyResolver() {
  const rows = await fetchAllRows((from, to) =>
    createAdminClient()
      .from("long_range_markets")
      .select("market_key, search_location, radius_km")
      .order("market_key")
      .range(from, to),
  );
  return (location: string, radiusKm: number) =>
    coveringMarket(rows, location, radiusKm)?.market_key ?? longRangeMarketKey(location, radiusKm);
}

export async function getMarketStatus(key: string) {
  return (await getMarketProgress([key])).get(key) ?? null;
}

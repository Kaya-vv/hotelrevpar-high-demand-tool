import { createHash } from "node:crypto";
import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/supabase/fetch-in-batches";
import {
  summarizeBatch,
  type BatchProgress,
} from "@/features/workspace/batch-progress";
import { longRangeMarketKey } from "./long-range-store";
import { getMarketProgress } from "./market-status";
import { researchIsPending } from "./research-status";

export type CollectionStatus = {
  batch: BatchProgress | null;
  pending: boolean;
  revision: string;
  watchKey: string;
  waitingForProvider?: boolean;
};

/** Caller resolves account/area ownership first; platform scope requires an admin role check. */
export async function getCollectionStatus(
  accountId: string,
  areaId: string | null,
  platform = false,
): Promise<CollectionStatus> {
  const db = await createServerClient();
  const { data: latest, error } = await db
    .from("collection_jobs")
    .select("batch_id")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const jobs = latest
    ? await fetchAllRows((from, to) =>
        db
          .from("collection_jobs")
          .select("id, status, pending_since")
          .eq("account_id", accountId)
          .eq("batch_id", latest.batch_id)
          .order("id")
          .range(from, to),
      )
    : [];
  const batch = latest ? summarizeBatch(latest.batch_id, jobs) : null;
  const columns =
    "id, collection_area_id, started_at, finished_at, requested:source_results->claude->researchPending";
  const runQuery = platform
    ? createAdminClient()
        .from("collection_runs")
        .select(columns)
        .order("started_at", { ascending: false })
        .limit(100)
    : db
        .from("collection_runs")
        .select(columns)
        .eq("account_id", accountId)
        .eq(
          "collection_area_id",
          areaId ?? "00000000-0000-0000-0000-000000000000",
        )
        .order("started_at", { ascending: false })
        .limit(1);
  const { data: runs, error: runError } = await runQuery;
  if (runError) throw runError;
  const needingResearch = runs.filter((run) => run.requested === true);
  const areas = needingResearch.length
    ? await fetchAllRows((from, to) =>
        (platform ? createAdminClient() : db)
          .from("collection_areas")
          .select("id, search_location, radius_km")
          .in("id", [
            ...new Set(needingResearch.map((run) => run.collection_area_id)),
          ])
          .order("id")
          .range(from, to),
      )
    : [];
  const markets = await getMarketProgress(
    areas.map((area) =>
      longRangeMarketKey(area.search_location, area.radius_km),
    ),
  );
  const states = runs.map((run) => {
    const area = areas.find((area) => area.id === run.collection_area_id);
    const market = area
      ? markets.get(longRangeMarketKey(area.search_location, area.radius_km))
      : undefined;
    return {
      id: run.id,
      finished: run.finished_at,
      pending:
        !run.finished_at ||
        researchIsPending(run.requested === true, run.started_at, market),
    };
  });
  // Attempt/heartbeat timestamps deliberately do not invalidate page data.
  const revision = createHash("sha256")
    .update(
      JSON.stringify([latest?.batch_id, batch?.active, batch?.failed, states]),
    )
    .digest("hex");
  return {
    batch,
    waitingForProvider: jobs.some(
      (job) => job.status === "running" && Boolean(job.pending_since),
    ),
    pending: Boolean(batch?.active || states.some((run) => run.pending)),
    revision,
    watchKey: `${areaId ?? ""}:${latest?.batch_id ?? runs[0]?.id ?? ""}`,
  };
}

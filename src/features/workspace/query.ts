import { getHotelScope } from "./hotel-context";
import { publishableReviewEventIds } from "@/features/events/importance";

export type BatchProgress = {
  batchId: string;
  total: number;
  completed: number;
  failed: number;
  active: boolean;
};

export function summarizeBatch(batchId: string, jobs: { status: string }[]): BatchProgress {
  return {
    batchId,
    total: jobs.length,
    completed: jobs.filter((job) => ["succeeded", "partial", "skipped"].includes(job.status)).length,
    failed: jobs.filter((job) => job.status === "failed").length,
    active: jobs.some((job) => ["queued", "running"].includes(job.status)),
  };
}

export async function getWorkspaceData(accountId: string) {
  const scope = await getHotelScope(accountId);
  let reviewCount = 0;
  if (scope.areaId) {
    const { data: links, error: linkError } = await scope.supabase
      .from("account_event_areas")
      .select("event_id")
      .eq("account_id", accountId)
      .eq("collection_area_id", scope.areaId);
    if (linkError) throw linkError;
    if (links.length && scope.selectedHotelId) {
      const [decisionsResult, scoresResult] = await Promise.all([
        scope.supabase
          .from("account_events")
          .select("event_id, state")
          .eq("account_id", accountId)
          .eq("state", "needs_review"),
        scope.supabase
          .from("hotel_event_scores")
          .select("event_id, suggested_importance, importance_override, impact_basis")
          .eq("hotel_id", scope.selectedHotelId),
      ]);
      if (decisionsResult.error) throw decisionsResult.error;
      if (scoresResult.error) throw scoresResult.error;
      const linkedIds = new Set(links.map((link) => link.event_id));
      reviewCount = [...publishableReviewEventIds(decisionsResult.data, scoresResult.data)]
        .filter((eventId) => linkedIds.has(eventId)).length;
    }
  }

  const { data: latestJob, error: latestError } = await scope.supabase
    .from("collection_jobs")
    .select("batch_id")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;

  let batch: BatchProgress | null = null;
  if (latestJob) {
    const { data: jobs, error } = await scope.supabase
      .from("collection_jobs")
      .select("status")
      .eq("account_id", accountId)
      .eq("batch_id", latestJob.batch_id);
    if (error) throw error;
    batch = summarizeBatch(latestJob.batch_id, jobs);
  }

  return { ...scope, reviewCount, batch };
}

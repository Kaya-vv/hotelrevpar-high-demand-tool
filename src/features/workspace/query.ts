import { fetchAllRows, fetchInBatches } from "@/lib/supabase/fetch-in-batches";
import { getHotelScope } from "./hotel-context";
import { publishableReviewEventIds } from "@/features/events/importance";

export { summarizeBatch, type BatchProgress } from "./batch-progress";

export async function getWorkspaceData(accountId: string) {
  const scope = await getHotelScope(accountId);
  let reviewCount = 0;
  if (scope.areaId) {
    const links = await fetchAllRows((from, to) => scope.supabase.from("account_event_areas")
      .select("event_id").eq("account_id", accountId).eq("collection_area_id", scope.areaId!)
      .order("event_id").range(from, to));
    if (links.length && scope.selectedHotelId) {
      const decisions = await fetchInBatches(links.map(link => link.event_id), ids => scope.supabase
        .from("account_events").select("event_id, state").eq("account_id", accountId)
        .eq("state", "needs_review").in("event_id", ids));
      const scores = await fetchInBatches(decisions.map(decision => decision.event_id), ids => scope.supabase
        .from("hotel_event_scores").select("event_id, suggested_importance, importance_override, impact_basis")
        .eq("hotel_id", scope.selectedHotelId!).in("event_id", ids));
      reviewCount = publishableReviewEventIds(decisions, scores).size;
    }
  }
  const { getCollectionStatus } = await import("@/features/collection/status");

  const collectionStatus = await getCollectionStatus(accountId, scope.areaId);
  return { ...scope, reviewCount, batch: collectionStatus.batch, collectionStatus };
}

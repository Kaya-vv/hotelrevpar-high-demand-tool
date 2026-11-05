import { getHotelScope } from "./hotel-context";

export { summarizeBatch, type BatchProgress } from "./batch-progress";

export async function getWorkspaceData(accountId: string) {
  const scope = await getHotelScope(accountId);
  const { getCollectionStatus } = await import("@/features/collection/status");

  const collectionStatus = await getCollectionStatus(accountId, scope.areaId);
  return { ...scope, batch: collectionStatus.batch, collectionStatus };
}

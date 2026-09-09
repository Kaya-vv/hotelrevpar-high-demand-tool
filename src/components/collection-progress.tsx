"use client";

import type { BatchProgress } from "@/features/workspace/query";

export function CollectionProgress({
  batch,
  waitingForProvider = false,
}: {
  batch: BatchProgress | null;
  waitingForProvider?: boolean;
}) {
  if (!batch || (!batch.active && !batch.failed)) return null;
  return (
    <div
      className={
        batch.failed ? "collection-banner warning" : "collection-banner"
      }
      role="status"
    >
      <strong>
        {batch.active
          ? `Hotels bijwerken: ${batch.completed} van ${batch.total} gereed`
          : "Bijwerken afgerond met aandachtspunten"}
      </strong>
      {waitingForProvider && (
        <span>Wachten op verwerking door de onderzoeksdienst.</span>
      )}
      {batch.failed > 0 && (
        <span>{batch.failed} opdracht heeft aandacht nodig.</span>
      )}
    </div>
  );
}

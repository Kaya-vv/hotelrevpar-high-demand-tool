"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import type { BatchProgress } from "@/features/workspace/query";

export function CollectionProgress({ batch }: { batch: BatchProgress | null }) {
  const router = useRouter();
  useEffect(() => {
    if (!batch?.active) return;
    const timer = window.setInterval(() => router.refresh(), 3_000);
    return () => window.clearInterval(timer);
  }, [batch?.active, router]);

  if (!batch || (!batch.active && !batch.failed)) return null;
  return (
    <div className={batch.failed ? "collection-banner warning" : "collection-banner"} role="status">
      <strong>{batch.active ? `Hotels bijwerken: ${batch.completed} van ${batch.total} gereed` : "Bijwerken afgerond met aandachtspunten"}</strong>
      {batch.failed > 0 && <span>{batch.failed} opdracht heeft aandacht nodig.</span>}
    </div>
  );
}

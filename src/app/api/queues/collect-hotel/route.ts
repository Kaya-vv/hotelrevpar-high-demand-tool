import { handleCallback } from "@vercel/queue";
import { z } from "zod";

import { processCollectionJob, type CollectionJobMessage } from "@/features/collection/jobs";

export const maxDuration = 1800;

const messageSchema = z.union([
  z.object({ jobId: z.uuid() }),
  z.object({ kind: z.enum(["market-research", "market-publication"]), accountId: z.uuid(), areaId: z.uuid(), runId: z.uuid(), requestedAt: z.iso.datetime() }),
]);

export const POST = handleCallback<CollectionJobMessage>(
  async (message, metadata) => {
    const parsed = messageSchema.safeParse(message);
    if (!parsed.success) return;
    await processCollectionJob(parsed.data, metadata.deliveryCount);
  },
  {
    visibilityTimeoutSeconds: 900,
    retry: (_error, metadata) => ({ afterSeconds: Math.min(300, 15 * 2 ** Math.min(metadata.deliveryCount, 4)) }),
  },
);

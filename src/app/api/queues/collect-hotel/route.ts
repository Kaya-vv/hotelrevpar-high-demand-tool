import { handleCallback } from "@vercel/queue";
import { z } from "zod";

import { BatchPendingError } from "@/features/collection/anthropic-batches";
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
    await processCollectionJob(parsed.data, metadata);
  },
  {
    visibilityTimeoutSeconds: 900,
    // A batch takes hours while each wake-up is seconds of work, so a flat short interval bounds
    // post-completion latency far better than error backoff. The terminal case is handled in the
    // handler: this callback runs synchronously and cannot do the database writes it needs.
    retry: (error, metadata) => {
      if (error instanceof BatchPendingError) return { afterSeconds: 120 };
      return { afterSeconds: Math.min(300, 15 * 2 ** Math.min(metadata.deliveryCount, 4)) };
    },
  },
);

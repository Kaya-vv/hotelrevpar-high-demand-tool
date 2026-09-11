import { randomUUID } from "node:crypto";

import { BatchPendingError } from "./anthropic-batches";
import { errorMessage, runCollection } from "./run";
import { processMarketWork, type MarketWork } from "./market-research";

export const COLLECTION_TOPIC = "hotel-collection";

export type CollectionJobMessage = { jobId: string } | MarketWork;
export type CollectionJobTrigger = "cron" | "manual";
export type EnqueueResult = { batchId: string; queued: number; skipped: number; failed: number };

type Publisher = (message: CollectionJobMessage) => Promise<void>;

export async function publishCollectionJob(
  message: CollectionJobMessage,
  localProcessor = processCollectionJob,
) {
  if (process.env.NODE_ENV === "development") {
    // ponytail: local development gets one in-process attempt; Vercel Queues owns production retries.
    setTimeout(() => void localProcessor(message, { deliveryCount: 1, expiresAt: new Date(Date.now() + 86_400_000) }).catch(console.error), 0);
    return;
  }
  const { send } = await import("@vercel/queue");
  await send(COLLECTION_TOPIC, message, {
    // A pending hotel refresh revisits this publisher. Research belongs to the run,
    // while an explicitly requested publication may be repeated for that same run.
    idempotencyKey: "jobId" in message ? message.jobId
      : message.kind === "market-research" ? `${message.runId}:${message.kind}`
        : `${message.runId}:${message.kind}:${message.requestedAt}`,
    // Anthropic batches may use their full 24-hour processing window before a retry completes.
    retentionSeconds: 172_800,
  });
}

class JobPersistenceError extends Error {
  constructor(cause: unknown) { super("Collection status could not be saved", { cause }); }
}
async function persistJob(write: PromiseLike<{ error: unknown }>) {
  const { error } = await write;
  if (error) throw new JobPersistenceError(error);
}

/**
 * A run that fails on its own stored data fails identically every time. Redelivery ran until the
 * 48-hour message retention expired: Groningen burned 33 attempts on one undated event. Batch
 * wake-ups take the resume path and never touch `attempts`, so this only counts real tries.
 */
const MAX_ATTEMPTS = 5;

export async function enqueueCollectionAreas(
  input: {
    accountId: string;
    areaIds: string[];
    trigger: CollectionJobTrigger;
    createdBy?: string | null;
  },
  publisher: Publisher = publishCollectionJob,
): Promise<EnqueueResult> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const batchId = randomUUID();
  const areaIds = [...new Set(input.areaIds)];
  if (!areaIds.length) return { batchId, queued: 0, skipped: 0, failed: 0 };

  const { data: areas, error: areaError } = await admin
    .from("collection_areas")
    .select("id")
    .eq("account_id", input.accountId)
    .in("id", areaIds);
  if (areaError) throw areaError;

  const scopedAreaIds = areas.map((area) => area.id);
  const { data: activeJobs, error: activeError } = scopedAreaIds.length
    ? await admin
        .from("collection_jobs")
        .select("collection_area_id")
        .eq("account_id", input.accountId)
        .in("collection_area_id", scopedAreaIds)
        .in("status", ["queued", "running"])
    : { data: [], error: null };
  if (activeError) throw activeError;

  const activeAreas = new Set(activeJobs.map((job) => job.collection_area_id));
  const totals = { queued: 0, skipped: 0, failed: 0 };

  for (const areaId of scopedAreaIds) {
    const now = new Date().toISOString();
    const status = activeAreas.has(areaId) ? "skipped" : "queued";
    let { data: job, error } = await admin
      .from("collection_jobs")
      .insert({
        batch_id: batchId,
        account_id: input.accountId,
        collection_area_id: areaId,
        trigger: input.trigger,
        status,
        created_by: input.createdBy ?? null,
        finished_at: status === "skipped" ? now : null,
      })
      .select("id, status")
      .single();

    if (error?.code === "23505") {
      ({ data: job, error } = await admin
        .from("collection_jobs")
        .insert({
          batch_id: batchId,
          account_id: input.accountId,
          collection_area_id: areaId,
          trigger: input.trigger,
          status: "skipped",
          created_by: input.createdBy ?? null,
          finished_at: now,
        })
        .select("id, status")
        .single());
    }
    if (error) throw error;
    if (!job) throw new Error("Verzamelopdracht kon niet worden opgeslagen.");
    if (job.status === "skipped") {
      totals.skipped += 1;
      continue;
    }

    try {
      await publisher({ jobId: job.id });
      totals.queued += 1;
    } catch (error) {
      totals.failed += 1;
      await persistJob(admin
        .from("collection_jobs")
        .update({ status: "failed", finished_at: new Date().toISOString(), error_summary: errorMessage(error) })
        .eq("id", job.id));
    }
  }

  return { batchId, ...totals };
}

export async function processCollectionJob(
  messageBody: CollectionJobMessage,
  metadata: { deliveryCount: number; expiresAt: Date },
  run = runCollection,
) {
  if ("kind" in messageBody) return processMarketWork(messageBody);
  const { deliveryCount } = metadata;
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: job, error: jobError } = await admin
    .from("collection_jobs")
    .select("id, account_id, collection_area_id, trigger, status, pending_since, attempts")
    .eq("id", messageBody.jobId)
    .maybeSingle();
  if (jobError) throw jobError;
  if (!job || ["succeeded", "partial", "skipped"].includes(job.status)) return;

  // A pending continuation left its run open on purpose; only a killed worker needs recovery.
  if (deliveryCount > 1 && job.status === "running" && !job.pending_since) {
    const finishedAt = new Date().toISOString();
    const errorSummary = "Vorige poging afgebroken door een time-out; batch wordt hervat.";
    const { error: runError } = await admin
      .from("collection_runs")
      .update({ finished_at: finishedAt, error_summary: errorSummary })
      .eq("account_id", job.account_id)
      .eq("collection_area_id", job.collection_area_id)
      .is("finished_at", null);
    if (runError) throw runError;
  }

  const [{ data: account, error: accountError }, { data: area, error: areaError }] = await Promise.all([
    admin.from("accounts").select("id").eq("id", job.account_id).eq("active", true).maybeSingle(),
    admin
      .from("collection_areas")
      .select("id")
      .eq("id", job.collection_area_id)
      .eq("account_id", job.account_id)
      .maybeSingle(),
  ]);
  if (accountError) throw accountError;
  if (areaError) throw areaError;
  if (!account || !area) {
    await persistJob(admin
      .from("collection_jobs")
      .update({
        status: "failed",
        attempts: deliveryCount,
        finished_at: new Date().toISOString(),
        pending_since: null,
        error_summary: "Account of hotel bestaat niet meer.",
      })
      .eq("id", job.id));
    return;
  }

  const resume = Boolean(job.pending_since);
  await persistJob(admin
    .from("collection_jobs")
    .update(resume
      // Waking up to check a batch is not a new attempt, and it did not restart the work.
      ? { status: "running" }
      : {
        status: "running",
        attempts: deliveryCount,
        started_at: new Date().toISOString(),
        finished_at: null,
        error_summary: null,
      })
    .eq("id", job.id));

  try {
    const result = await run({
      accountId: job.account_id,
      areaId: job.collection_area_id,
      trigger: job.trigger,
      resume,
    });
    const status = result.status === "completed"
      ? "succeeded"
      : result.status === "already_running"
        ? "skipped"
        : "partial";
    await persistJob(admin
      .from("collection_jobs")
      .update({
        status,
        collection_run_id: result.runId || null,
        finished_at: new Date().toISOString(),
        pending_since: null,
      })
      .eq("id", job.id));
  } catch (error) {
    // A failed terminal write is not a provider failure. Preserve the run for retry.
    if (error instanceof JobPersistenceError) throw error;
    if (error instanceof BatchPendingError) {
      // The retry directive is useless once the message stops being redelivered, so the last
      // useful delivery closes the job itself instead of leaving it `running` forever.
      if (Date.now() + 120_000 >= metadata.expiresAt.getTime()) {
        const summary = "Anthropic batch niet voltooid binnen de berichtretentie.";
        await persistJob(admin
          .from("collection_jobs")
          .update({ status: "failed", pending_since: null, finished_at: new Date().toISOString(), error_summary: summary })
          .eq("id", job.id));
        const { error: runError } = await admin
          .from("collection_runs")
          .update({ finished_at: new Date().toISOString(), error_summary: summary })
          .eq("account_id", job.account_id)
          .eq("collection_area_id", job.collection_area_id)
          .is("finished_at", null);
        if (runError) throw runError;
        return;
      }
      await persistJob(admin
        .from("collection_jobs")
        .update({ pending_since: new Date().toISOString() })
        .eq("id", job.id));
      throw error;
    }
    const exhausted = (job.attempts ?? 0) + 1 >= MAX_ATTEMPTS;
    await persistJob(admin
      .from("collection_jobs")
      .update({
        status: "failed",
        attempts: deliveryCount,
        finished_at: new Date().toISOString(),
        pending_since: null,
        error_summary: exhausted
          ? `${errorMessage(error)} (gestopt na ${MAX_ATTEMPTS} pogingen)`
          : errorMessage(error),
      })
      .eq("id", job.id));
    // Returning acknowledges the message. Rethrowing asks for another delivery, which is only
    // worth doing while the failure could still be transient.
    if (exhausted) return;
    throw error;
  }
}

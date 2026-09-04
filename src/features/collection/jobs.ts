import { randomUUID } from "node:crypto";

import { runCollection } from "./run";

export const COLLECTION_TOPIC = "hotel-collection";

export type CollectionJobMessage = { jobId: string };
export type CollectionJobTrigger = "cron" | "manual";
export type EnqueueResult = { batchId: string; queued: number; skipped: number; failed: number };

type Publisher = (message: CollectionJobMessage) => Promise<void>;

export async function publishCollectionJob(
  message: CollectionJobMessage,
  localProcessor = processCollectionJob,
) {
  if (process.env.NODE_ENV === "development") {
    // ponytail: local development gets one in-process attempt; Vercel Queues owns production retries.
    setTimeout(() => void localProcessor(message, 1).catch(console.error), 0);
    return;
  }
  const { send } = await import("@vercel/queue");
  await send(COLLECTION_TOPIC, message, {
    idempotencyKey: message.jobId,
    retentionSeconds: 86_400,
  });
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

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
      await admin
        .from("collection_jobs")
        .update({ status: "failed", finished_at: new Date().toISOString(), error_summary: message(error) })
        .eq("id", job.id);
    }
  }

  return { batchId, ...totals };
}

export async function processCollectionJob(
  messageBody: CollectionJobMessage,
  deliveryCount: number,
  run = runCollection,
) {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: job, error: jobError } = await admin
    .from("collection_jobs")
    .select("id, account_id, collection_area_id, trigger, status")
    .eq("id", messageBody.jobId)
    .maybeSingle();
  if (jobError) throw jobError;
  if (!job || ["succeeded", "partial", "skipped"].includes(job.status)) return;

  if (deliveryCount > 1 && job.status === "running") {
    const finishedAt = new Date().toISOString();
    const errorSummary = "Verzameling afgebroken door een time-out.";
    const { error: runError } = await admin
      .from("collection_runs")
      .update({ finished_at: finishedAt, error_summary: errorSummary })
      .eq("account_id", job.account_id)
      .eq("collection_area_id", job.collection_area_id)
      .is("finished_at", null);
    if (runError) throw runError;

    const { error: updateError } = await admin
      .from("collection_jobs")
      .update({
        status: "failed",
        attempts: deliveryCount,
        finished_at: finishedAt,
        error_summary: errorSummary,
      })
      .eq("id", job.id);
    if (updateError) throw updateError;
    return;
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
    await admin
      .from("collection_jobs")
      .update({
        status: "failed",
        attempts: deliveryCount,
        finished_at: new Date().toISOString(),
        error_summary: "Account of hotel bestaat niet meer.",
      })
      .eq("id", job.id);
    return;
  }

  await admin
    .from("collection_jobs")
    .update({
      status: "running",
      attempts: deliveryCount,
      started_at: new Date().toISOString(),
      finished_at: null,
      error_summary: null,
    })
    .eq("id", job.id);

  try {
    const result = await run({
      accountId: job.account_id,
      areaId: job.collection_area_id,
      trigger: job.trigger,
    });
    const status = result.status === "completed"
      ? "succeeded"
      : result.status === "already_running"
        ? "skipped"
        : "partial";
    await admin
      .from("collection_jobs")
      .update({
        status,
        collection_run_id: result.runId || null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", job.id);
  } catch (error) {
    await admin
      .from("collection_jobs")
      .update({
        status: "failed",
        attempts: deliveryCount,
        finished_at: new Date().toISOString(),
        error_summary: message(error),
      })
      .eq("id", job.id);
    throw error;
  }
}

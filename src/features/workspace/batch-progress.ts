export type BatchProgress = {
  batchId: string;
  total: number;
  completed: number;
  failed: number;
  active: boolean;
};

export function summarizeBatch(
  batchId: string,
  jobs: { status: string }[],
): BatchProgress {
  return {
    batchId,
    total: jobs.length,
    completed: jobs.filter((job) =>
      ["succeeded", "partial", "skipped"].includes(job.status),
    ).length,
    failed: jobs.filter((job) => job.status === "failed").length,
    active: jobs.some((job) => ["queued", "running"].includes(job.status)),
  };
}

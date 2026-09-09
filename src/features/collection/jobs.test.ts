import { BatchPendingError } from "./anthropic-batches";
import { afterEach, describe, expect, it, vi } from "vitest";

const adminHolder = vi.hoisted(() => ({ current: {} }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminHolder.current }));
vi.mock("@vercel/queue", () => ({ send: vi.fn().mockResolvedValue({ messageId: "message" }) }));

import { enqueueCollectionAreas, processCollectionJob, publishCollectionJob } from "./jobs";
import { send } from "@vercel/queue";

function selectable(data: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.in.mockReturnValue(query);
  return query;
}

const delivery = (deliveryCount: number) => ({ deliveryCount, expiresAt: new Date(Date.now() + 86_400_000) });

describe("collection jobs", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("deduplicates research across refresh retries but allows another run", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(send).mockClear();
    const work = { kind: "market-research" as const, accountId: "account", areaId: "area", runId: "run-1", requestedAt: "2026-09-08T10:00:00Z" };
    await publishCollectionJob(work);
    await publishCollectionJob({ ...work, requestedAt: "2026-09-08T10:05:00Z" });
    await publishCollectionJob({ ...work, runId: "run-2" });
    const keys = vi.mocked(send).mock.calls.map((call) => call[2]?.idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("keeps deliberate publication requests separate for the same run", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(send).mockClear();
    const work = { kind: "market-publication" as const, accountId: "account", areaId: "area", runId: "run-1", requestedAt: "2026-09-08T10:00:00Z" };
    await publishCollectionJob(work);
    await publishCollectionJob({ ...work, requestedAt: "2026-09-08T10:05:00Z" });
    const keys = vi.mocked(send).mock.calls.map((call) => call[2]?.idempotencyKey);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("processes a development job without Vercel authentication", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const processor = vi.fn().mockResolvedValue(undefined);

    await publishCollectionJob({ jobId: "job-1" }, processor);

    await vi.waitFor(() => expect(processor).toHaveBeenCalledWith({ jobId: "job-1" }, { deliveryCount: 1, expiresAt: expect.any(Date) }));
  });

  it("queues only hotels that belong to the requested account", async () => {
    const areaQuery = selectable([{ id: "area-owned" }]);
    areaQuery.in.mockResolvedValue({ data: [{ id: "area-owned" }], error: null });
    const activeQuery = selectable([]);
    activeQuery.in.mockReturnValueOnce(activeQuery).mockResolvedValueOnce({ data: [], error: null });
    const single = vi.fn().mockResolvedValue({ data: { id: "job-1", status: "queued" }, error: null });
    const insert = vi.fn().mockReturnValue({ select: () => ({ single }) });
    adminHolder.current = {
      from: vi.fn((table: string) => table === "collection_areas" ? areaQuery : { ...activeQuery, insert }),
    };
    const publisher = vi.fn().mockResolvedValue(undefined);

    const result = await enqueueCollectionAreas({
      accountId: "account-1",
      areaIds: ["area-owned", "area-other"],
      trigger: "manual",
    }, publisher);

    expect(areaQuery.eq).toHaveBeenCalledWith("account_id", "account-1");
    expect(publisher).toHaveBeenCalledWith({ jobId: "job-1" });
    expect(result).toMatchObject({ queued: 1, skipped: 0, failed: 0 });
  });

  it("ignores a duplicate delivery after a job reaches a terminal state", async () => {
    const jobQuery = selectable({
      id: "job-1",
      account_id: "account-1",
      collection_area_id: "area-1",
      trigger: "manual",
      status: "succeeded",
    });
    adminHolder.current = { from: vi.fn(() => jobQuery) };
    const run = vi.fn();

    await processCollectionJob({ jobId: "job-1" }, delivery(2), run);

    expect(run).not.toHaveBeenCalled();
  });

  it("closes a timed-out run and resumes its cached batch on redelivery", async () => {
    const jobUpdates: Array<Record<string, unknown>> = [];
    const jobQuery = selectable({
      id: "job-1",
      account_id: "account-1",
      collection_area_id: "area-1",
      trigger: "manual",
      status: "running",
    });
    Object.assign(jobQuery, {
      update: vi.fn((value: Record<string, unknown>) => {
        jobUpdates.push(value);
        return { eq: vi.fn().mockResolvedValue({ error: null }) };
      }),
    });
    const runUpdate = {
      eq: vi.fn(),
      is: vi.fn().mockResolvedValue({ error: null }),
    };
    runUpdate.eq.mockReturnValue(runUpdate);
    const runQuery = {
      update: vi.fn().mockReturnValue(runUpdate),
    };
    const accountQuery = selectable({ id: "account-1" });
    const areaQuery = selectable({ id: "area-1" });
    adminHolder.current = {
      from: vi.fn((table: string) => table === "collection_jobs"
        ? jobQuery
        : table === "collection_runs"
          ? runQuery
          : table === "accounts"
            ? accountQuery
            : areaQuery),
    };
    const run = vi.fn().mockResolvedValue({ runId: "run-2", status: "completed" });

    await processCollectionJob({ jobId: "job-1" }, delivery(2), run);

    expect(run).toHaveBeenCalledWith({
      accountId: "account-1",
      areaId: "area-1",
      trigger: "manual",
      resume: false,
    });
    expect(runQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      error_summary: "Vorige poging afgebroken door een time-out; batch wordt hervat.",
    }));
    expect(jobUpdates).toEqual([
      expect.objectContaining({ status: "running", attempts: 2 }),
      expect.objectContaining({ status: "succeeded", collection_run_id: "run-2" }),
    ]);
  });

  it("records a failed attempt and rethrows so Vercel can retry it", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const jobQuery = selectable({
      id: "job-1",
      account_id: "account-1",
      collection_area_id: "area-1",
      trigger: "manual",
      status: "failed",
    });
    Object.assign(jobQuery, {
      update: vi.fn((value: Record<string, unknown>) => {
        updates.push(value);
        return { eq: vi.fn().mockResolvedValue({ error: null }) };
      }),
    });
    const accountQuery = selectable({ id: "account-1" });
    const areaQuery = selectable({ id: "area-1" });
    adminHolder.current = {
      from: vi.fn((table: string) => table === "collection_jobs" ? jobQuery : table === "accounts" ? accountQuery : areaQuery),
    };
    const run = vi.fn().mockRejectedValue(new Error("provider unavailable"));

    await expect(processCollectionJob({ jobId: "job-1" }, delivery(3), run)).rejects.toThrow("provider unavailable");
    expect(updates).toEqual([
      expect.objectContaining({ status: "running", attempts: 3 }),
      expect.objectContaining({ status: "failed", attempts: 3, error_summary: "provider unavailable" }),
    ]);
  });
});

it.each(["running", "succeeded"])("surfaces a failed %s write without recording provider failure", async failedStatus => {
  const updates: string[] = [];
  const job = selectable({ id: "job", account_id: "account", collection_area_id: "area", trigger: "manual", status: "queued" });
  Object.assign(job, { update: (value: { status: string }) => {
    updates.push(value.status);
    return { eq: async () => ({ error: value.status === failedStatus ? new Error("database timeout") : null }) };
  } });
  adminHolder.current = { from: (table: string) => table === "collection_jobs" ? job : selectable({ id: "owned" }) };
  const run = vi.fn().mockResolvedValue({ status: "completed", runId: "run" });
  await expect(processCollectionJob({ jobId: "job" }, delivery(1), run)).rejects.toThrow("Collection status could not be saved");
  expect(updates).not.toContain("failed");
  expect(run).toHaveBeenCalledTimes(failedStatus === "running" ? 0 : 1);
});

it("resumes a provider wait without opening a new attempt", async () => {
  const updates: Record<string, unknown>[] = [];
  const job = selectable({ id: "job", account_id: "account", collection_area_id: "area", trigger: "manual", status: "running", pending_since: "2026-09-09T12:00:00Z" });
  Object.assign(job, { update: (value: Record<string, unknown>) => {
    updates.push(value); return { eq: async () => ({ error: null }) };
  } });
  adminHolder.current = { from: (table: string) => table === "collection_jobs" ? job : selectable({ id: "owned" }) };
  const run = vi.fn().mockRejectedValue(new BatchPendingError());
  await expect(processCollectionJob({ jobId: "job" }, delivery(4), run)).rejects.toBeInstanceOf(BatchPendingError);
  expect(run).toHaveBeenCalledWith(expect.objectContaining({ resume: true }));
  expect(updates[0]).toEqual({ status: "running" });
  expect(updates[1]).toHaveProperty("pending_since");
});
it("ignores a duplicate delivery after terminal success", async () => {
  adminHolder.current = { from: () => selectable({ id: "job", status: "succeeded" }) };
  const run = vi.fn();
  await processCollectionJob({ jobId: "job" }, delivery(3), run);
  expect(run).not.toHaveBeenCalled();
});

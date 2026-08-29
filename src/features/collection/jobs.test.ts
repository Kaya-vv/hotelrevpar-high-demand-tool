import { afterEach, describe, expect, it, vi } from "vitest";

const adminHolder = vi.hoisted(() => ({ current: {} }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminHolder.current }));

import { enqueueCollectionAreas, processCollectionJob, publishCollectionJob } from "./jobs";

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

describe("collection jobs", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("processes a development job without Vercel authentication", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const processor = vi.fn().mockResolvedValue(undefined);

    await publishCollectionJob({ jobId: "job-1" }, processor);

    await vi.waitFor(() => expect(processor).toHaveBeenCalledWith({ jobId: "job-1" }, 1));
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

    await processCollectionJob({ jobId: "job-1" }, 2, run);

    expect(run).not.toHaveBeenCalled();
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

    await expect(processCollectionJob({ jobId: "job-1" }, 3, run)).rejects.toThrow("provider unavailable");
    expect(updates).toEqual([
      expect.objectContaining({ status: "running", attempts: 3 }),
      expect.objectContaining({ status: "failed", attempts: 3, error_summary: "provider unavailable" }),
    ]);
  });
});

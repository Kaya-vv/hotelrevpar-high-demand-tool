import { afterEach, describe, expect, it, vi } from "vitest";

import { createCronHandler, GET } from "./route";
import { enqueueCollectionAreas } from "@/features/collection/jobs";

const dbState = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]> }));
vi.mock("@/features/collection/jobs", () => ({ enqueueCollectionAreas: vi.fn(async () => ({ queued: 1, skipped: 0, failed: 0, batchId: "batch" })) }));
vi.mock("@/features/notifications/service", () => ({ enqueuePendingEventNotifications: vi.fn(async () => ({ queued: 0 })) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  let rows = dbState.tables[table] ?? [];
  const query = {
    select: () => query, order: () => query,
    eq: (key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return query; },
    is: () => query,
    not: (key: string, _operator: string, value: unknown) => { rows = rows.filter(row => row[key] !== value); return query; },
    in: (key: string, values: unknown[]) => { rows = rows.filter(row => values.includes(row[key])); return query; },
    gte: (key: string, value: string) => { rows = rows.filter(row => String(row[key]) >= value); return query; },
    range: (from: number, to: number) => { rows = rows.slice(from, to + 1); return query; },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  return query;
} }) }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("collection Cron", () => {
  it("rejects a missing bearer secret", async () => {
    const enqueue = vi.fn();
    const handler = createCronHandler({ secret: "secret", listAreas: vi.fn(), enqueue });
    const response = await handler(new Request("http://localhost/api/cron/collect"));
    expect(response.status).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("enqueues one batch per account with the matching secret", async () => {
    const enqueue = vi.fn().mockResolvedValue({ batchId: "batch-1", queued: 2, skipped: 0, failed: 0 });
    const enqueueNotifications = vi.fn().mockResolvedValue({ queued: 3 });
    const handler = createCronHandler({
      secret: "secret",
      listAreas: vi.fn().mockResolvedValue([
        { id: "area-1", accountId: "account-1" },
        { id: "area-2", accountId: "account-1" },
      ]),
      enqueue,
      enqueueNotifications,
    });
    const response = await handler(new Request("http://localhost/api/cron/collect", { headers: { authorization: "Bearer secret" } }));
    expect(response.status).toBe(200);
    expect(enqueue).toHaveBeenCalledWith({ accountId: "account-1", areaIds: ["area-1", "area-2"], trigger: "cron" });
    await expect(response.json()).resolves.toMatchObject({ notifications: { queued: 3 } });
  });

  it("does not fail hotel updates when pending mail cannot be queued", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = createCronHandler({
      secret: "secret",
      listAreas: vi.fn().mockResolvedValue([]),
      enqueue: vi.fn(),
      enqueueNotifications: vi.fn().mockRejectedValue(new Error("mail queue unavailable")),
    });
    const response = await handler(new Request("http://localhost/api/cron/collect", {
      headers: { authorization: "Bearer secret" },
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ notifications: { queued: 0 } });
  });
});


it("the daily scheduler skips recent automatic and manual runs and includes first searches", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T05:00:00Z"));
  vi.stubEnv("CRON_SECRET", "secret");
  vi.mocked(enqueueCollectionAreas).mockClear();
  dbState.tables = {
    accounts: [{ id: "account", active: true }],
    collection_areas: ["due", "recent", "manual", "new"].map(id => ({ id, account_id: "account", hotel_id: id })),
    collection_runs: [
      { id: "r1", collection_area_id: "due", started_at: "2026-09-21T15:45:00Z" },
      { id: "r2", collection_area_id: "recent", started_at: "2026-09-28T05:00:00Z" },
      { id: "r3", collection_area_id: "manual", started_at: "2026-10-03T16:00:00Z", trigger: "manual" },
    ],
  };
  const response = await GET(new Request("http://localhost/api/cron/collect", { headers: { authorization: "Bearer secret" } }));
  expect(response.status).toBe(200);
  expect(enqueueCollectionAreas).toHaveBeenCalledExactlyOnceWith({ accountId: "account", areaIds: ["due", "new"], trigger: "cron" });
});

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
    is: () => query, or: () => query,
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

  it("enqueues one batch per account and scope with the matching secret", async () => {
    const enqueue = vi.fn().mockResolvedValue({ batchId: "batch-1", queued: 2, skipped: 0, failed: 0 });
    const enqueueNotifications = vi.fn().mockResolvedValue({ queued: 3 });
    const handler = createCronHandler({
      secret: "secret",
      listAreas: vi.fn().mockResolvedValue([
        { id: "area-1", accountId: "account-1", scope: "full" },
        { id: "area-2", accountId: "account-1", scope: "ticketmaster" },
        { id: "area-3", accountId: "account-1", scope: "ticketmaster" },
      ]),
      enqueue,
      enqueueNotifications,
    });
    const response = await handler(new Request("http://localhost/api/cron/collect", { headers: { authorization: "Bearer secret" } }));
    expect(response.status).toBe(200);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith({ accountId: "account-1", areaIds: ["area-1"], trigger: "cron", scope: "full" });
    expect(enqueue).toHaveBeenCalledWith({ accountId: "account-1", areaIds: ["area-2", "area-3"], trigger: "cron", scope: "ticketmaster" });
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


const cronRequest = () => GET(new Request("http://localhost/api/cron/collect", { headers: { authorization: "Bearer secret" } }));

const queued = (scope: string) => vi.mocked(enqueueCollectionAreas).mock.calls
  .filter(([input]) => input.scope === scope).flatMap(([input]) => input.areaIds);

it("the daily scheduler skips recent automatic and manual runs, waits for a hotel's weekday and includes first searches", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T05:00:00Z")); // Wednesday
  vi.stubEnv("CRON_SECRET", "secret");
  vi.mocked(enqueueCollectionAreas).mockClear();
  dbState.tables = {
    accounts: [{ id: "account", active: true }],
    collection_areas: ["due", "later", "recent", "manual", "new", "untracked"].map(id => ({ id, account_id: "account", hotel_id: id,
      enabled_sources: id === "untracked" ? ["claude"] : ["claude", "ticketmaster"] })),
    collection_runs: [
      { id: "r1", collection_area_id: "due", started_at: "2026-09-21T15:45:00Z", scope: "full" },
      { id: "r2", collection_area_id: "recent", started_at: "2026-09-22T05:00:00Z", scope: "full" },
      { id: "r3", collection_area_id: "manual", started_at: "2026-10-03T16:00:00Z", trigger: "manual", scope: "full" },
      { id: "r4", collection_area_id: "later", started_at: "2026-09-01T05:00:00Z", scope: "full" },
      // Yesterday's Ticketmaster check is not a search, so it must not push the weekly one back.
      { id: "r5", collection_area_id: "later", started_at: "2026-10-20T05:00:00Z", scope: "ticketmaster" },
      // Nor does a Ticketmaster check count as a first search.
      { id: "r6", collection_area_id: "new", started_at: "2026-10-20T05:00:00Z", scope: "ticketmaster" },
      { id: "r7", collection_area_id: "untracked", started_at: "2026-10-20T05:00:00Z", scope: "full" },
    ],
  };
  const response = await cronRequest();
  expect(response.status).toBe(200);
  // "due" is overdue but its weekday is Monday; "later" is Wednesday's hotel; "new" never ran.
  // "untracked" has Ticketmaster switched off, so it gets nothing between its weekly searches.
  expect(queued("full")).toEqual(["later", "new"]);
  expect(queued("ticketmaster")).toEqual(["due", "recent", "manual"]);
});

it("spreads ten due hotels over the working week and checks Ticketmaster for all the others every day", async () => {
  vi.useFakeTimers();
  vi.stubEnv("CRON_SECRET", "secret");
  const ids = Array.from({ length: 10 }, (_, index) => `area-${index + 1}`);
  const queuedOn: Record<string, string[]> = {};
  // Monday 19 October 2026 through Sunday 25 October.
  for (const day of ["19", "20", "21", "22", "23", "24", "25"]) {
    vi.setSystemTime(new Date(`2026-10-${day}T05:00:00Z`));
    vi.mocked(enqueueCollectionAreas).mockClear();
    dbState.tables = {
      accounts: [{ id: "account", active: true }],
      collection_areas: ids.map(id => ({ id, account_id: "account", hotel_id: id, enabled_sources: ["ticketmaster"] })),
      collection_runs: ids.map(id => ({ id: `run-${id}`, collection_area_id: id, started_at: "2026-08-01T05:00:00Z", scope: "full" })),
    };
    await cronRequest();
    queuedOn[day] = queued("full");
    expect([...queuedOn[day], ...queued("ticketmaster")].sort()).toEqual([...ids].sort());
  }
  expect(queuedOn["24"]).toEqual([]);
  expect(queuedOn["25"]).toEqual([]);
  expect(Object.values(queuedOn).flat().sort()).toEqual([...ids].sort());
  expect(Object.values(queuedOn).filter(areas => areas.length).length).toBeGreaterThanOrEqual(4);
});

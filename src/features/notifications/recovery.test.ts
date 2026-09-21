import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, fail: "", eventIds: ["event"] }));
const publish = vi.hoisted(() => vi.fn());
vi.mock("@/features/collection/jobs", () => ({ publishCollectionJob: publish }));
vi.mock("./query", () => ({ loadVisibleNotificationEvents: async () => ({ id: "hotel", name: "Hotel", events: state.eventIds.map(id => ({ id, title: `Festival ${id}`, startAt: "2027-06-01", endAt: "2027-06-02", level: "High", venue: "Venue" })) }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));
const admin = {
  auth: { admin: { getUserById: async () => ({ data: { user: { email: "hotel@example.com" } }, error: null }) } },
  rpc: async (_: string, args: Record<string, string>) => {
    if (state.fail === "claim") { state.fail = ""; return { data: null, error: new Error("claim interrupted") }; }
    const items = state.tables.event_notification_items.filter(row => row.batch_id === null && !row.suppressed);
    items.forEach(row => { row.batch_id = args.p_batch; });
    return { data: items.map(row => ({ event_id: row.event_id })), error: null };
  },
  from: (table: string) => {
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    let action = "select";
    let values: Record<string, unknown> | Record<string, unknown>[] = {};
    let single = false;
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      is: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      lt: (key: string, value: string) => { filters.push(row => String(row[key]) < value); return query; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query; },
      order: () => query, range: () => query, limit: () => query,
      maybeSingle: () => { single = true; return query; },
      upsert: (rows: Record<string, unknown>[]) => { action = "upsert"; values = rows; return query; },
      insert: (row: Record<string, unknown>) => { action = "insert"; values = row; return query; },
      update: (row: Record<string, unknown>) => { action = "update"; values = row; return query; },
      then: (resolve: (value: unknown) => unknown) => {
        if (action === "insert" && state.fail === "insert") { state.fail = ""; return Promise.resolve({ data: null, error: new Error("insert interrupted") }).then(resolve); }
        const rows = state.tables[table] ?? [];
        if (action === "upsert") for (const row of values as Record<string, unknown>[]) {
          if (!rows.some(old => old.user_id === row.user_id && old.hotel_id === row.hotel_id && old.event_id === row.event_id)) rows.push({ batch_id: null, ...row });
        }
        if (action === "insert") rows.push({ status: "preparing", ...values });
        const selected = rows.filter(row => filters.every(filter => filter(row)));
        if (action === "update") selected.forEach(row => Object.assign(row, values));
        return Promise.resolve({ data: single ? selected[0] ?? null : selected, error: null }).then(resolve);
      },
    };
    return query;
  },
};
import { enqueuePendingEventNotifications, stageHotelEventNotifications, sendEventNotification } from "./service";
beforeEach(() => {
  vi.stubEnv("EVENT_NOTIFICATIONS_ENABLED", "enabled");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.com");
  publish.mockClear();
  state.fail = "";
  state.eventIds = ["event"];
  state.tables = { collection_areas: [{ id: "area", account_id: "account", hotel_id: "hotel" }], account_members: [{ account_id: "account", user_id: "user", event_notifications_enabled: true }], event_notification_items: [], event_notification_batches: [] };
});
it.each(["insert", "claim"])("recovers after %s failure without another new event", async (failure) => {
  state.fail = failure;
  await expect(stageHotelEventNotifications("account", "area")).rejects.toThrow("interrupted");
  expect(state.tables.event_notification_items[0].batch_id).toBeNull();
  await enqueuePendingEventNotifications();
  const item = state.tables.event_notification_items[0];
  expect(item.batch_id).toBeTruthy();
  expect(state.tables.event_notification_batches.find(row => row.id === item.batch_id)?.status).toBe("pending");
  expect(publish).toHaveBeenCalledWith({ kind: "event-notification", batchId: item.batch_id });
  const count = state.tables.event_notification_batches.length;
  await stageHotelEventNotifications("account", "area");
  expect(state.tables.event_notification_batches).toHaveLength(count);
});
it("does not revive suppressed events", async () => {
  state.tables.event_notification_items.push({ account_id: "account", user_id: "user", hotel_id: "hotel", event_id: "event", batch_id: null, suppressed: true });
  await enqueuePendingEventNotifications();
  await stageHotelEventNotifications("account", "area");
  expect(publish).not.toHaveBeenCalled();
  expect(state.tables.event_notification_batches).toHaveLength(0);
});

it("does not send a prepared email after its hotel is archived", async () => {
  state.tables.hotels = [{ id: "hotel", account_id: "account", archived_at: "2026-09-16T12:00:00Z" }];
  state.tables.event_notification_batches.push({ id: "batch", status: "pending", account_id: "account", hotel_id: "hotel", user_id: "user" });
  const fetcher = vi.fn();
  await sendEventNotification("batch", fetcher);
  expect(fetcher).not.toHaveBeenCalled();
  expect(state.tables.event_notification_batches[0].status).toBe("cancelled");
});


it("waits for a queued hotel refresh before preparing shared-city results", async () => {
  state.tables.collection_jobs = [{ id: "job", collection_area_id: "area", status: "queued" }];
  expect(await stageHotelEventNotifications("account", "area")).toEqual({ queued: 0 });
  expect(state.tables.event_notification_batches).toHaveLength(0);
  state.tables.collection_jobs[0].status = "succeeded";
  state.eventIds.push("second", "third");
  expect(await stageHotelEventNotifications("account", "area")).toEqual({ queued: 1 });
  const batch = state.tables.event_notification_batches[0];
  expect(batch.subject).toBe("3 nieuwe events voor Hotel");
  for (const id of state.eventIds) expect(batch.text_body).toContain(`Festival ${id}`);
  expect(state.tables.event_notification_items.every(item => item.batch_id === batch.id)).toBe(true);
  await stageHotelEventNotifications("account", "area");
  expect(state.tables.event_notification_batches).toHaveLength(1);
});

it("does not call an old hotel event new just because the launch baseline missed it", async () => {
  state.tables.event_notification_items.push({ account_id: "account", hotel_id: "hotel", user_id: "user", event_id: "baseline", created_at: "2026-09-15T11:55:00Z", suppressed: true, batch_id: null });
  state.tables.account_event_areas = [{ account_id: "account", collection_area_id: "area", event_id: "event", created_at: "2026-09-03T17:31:00Z" }];
  await stageHotelEventNotifications("account", "area");
  expect(state.tables.event_notification_items.find(row => row.event_id === "event")?.suppressed).toBe(true);
  expect(publish).not.toHaveBeenCalled();
});

it("still sends a genuinely new hotel link after the baseline", async () => {
  state.tables.event_notification_items.push({ account_id: "account", hotel_id: "hotel", user_id: "user", event_id: "baseline", created_at: "2026-09-15T11:55:00Z", suppressed: true, batch_id: null });
  state.tables.account_event_areas = [{ account_id: "account", collection_area_id: "area", event_id: "event", created_at: "2026-09-21T08:00:00Z" }];
  expect(await stageHotelEventNotifications("account", "area")).toEqual({ queued: 1 });
  expect(state.tables.event_notification_items.find(row => row.event_id === "event")?.suppressed).toBe(false);
});

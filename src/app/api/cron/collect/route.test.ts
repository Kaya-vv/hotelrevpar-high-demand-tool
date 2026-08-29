import { describe, expect, it, vi } from "vitest";

import { createCronHandler } from "./route";

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
    const handler = createCronHandler({
      secret: "secret",
      listAreas: vi.fn().mockResolvedValue([
        { id: "area-1", accountId: "account-1" },
        { id: "area-2", accountId: "account-1" },
      ]),
      enqueue,
    });
    const response = await handler(new Request("http://localhost/api/cron/collect", { headers: { authorization: "Bearer secret" } }));
    expect(response.status).toBe(200);
    expect(enqueue).toHaveBeenCalledWith({ accountId: "account-1", areaIds: ["area-1", "area-2"], trigger: "cron" });
  });
});

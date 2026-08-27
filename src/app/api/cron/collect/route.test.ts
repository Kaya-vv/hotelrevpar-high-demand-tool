import { describe, expect, it, vi } from "vitest";

import { createCronHandler } from "./route";

describe("collection Cron", () => {
  it("rejects a missing bearer secret", async () => {
    const run = vi.fn();
    const handler = createCronHandler({ secret: "secret", listAreas: vi.fn(), run });
    const response = await handler(new Request("http://localhost/api/cron/collect"));
    expect(response.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs areas in sequence with the matching secret", async () => {
    const run = vi.fn().mockResolvedValue({ status: "completed" });
    const handler = createCronHandler({
      secret: "secret",
      listAreas: vi.fn().mockResolvedValue([{ id: "area-1", accountId: "account-1" }]),
      run,
    });
    const response = await handler(new Request("http://localhost/api/cron/collect", { headers: { authorization: "Bearer secret" } }));
    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith({ accountId: "account-1", areaId: "area-1", trigger: "cron" });
  });
});

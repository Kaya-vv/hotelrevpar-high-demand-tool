import { describe, expect, it } from "vitest";

import { isPublicPath } from "./proxy";

describe("isPublicPath", () => {
  it("allows platform-triggered endpoints without opening user APIs", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/api/cron/collect")).toBe(true);
    expect(isPublicPath("/api/queues/collect-hotel")).toBe(true);
    expect(isPublicPath("/api/export")).toBe(false);
  });
});

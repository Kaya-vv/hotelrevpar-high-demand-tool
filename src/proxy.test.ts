import { describe, expect, it } from "vitest";

import { isPublicPath } from "./proxy";

describe("isPublicPath", () => {
  it("allows the login and signed cron endpoint without opening user APIs", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/api/cron/collect")).toBe(true);
    expect(isPublicPath("/api/export")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { safeNextPath } from "./route";

describe("safeNextPath", () => {
  it("keeps redirects inside the application", () => {
    expect(safeNextPath("/auth/set-password")).toBe("/auth/set-password");
    expect(safeNextPath("//malicious.example")).toBe("/calendar");
    expect(safeNextPath("/\\malicious.example")).toBe("/calendar");
    expect(safeNextPath("https://malicious.example")).toBe("/calendar");
    expect(safeNextPath("http://[")).toBe("/calendar");
  });
});

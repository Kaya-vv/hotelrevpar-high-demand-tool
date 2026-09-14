import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }));
import { createServerClient } from "@/lib/supabase/server";
import { GET, safeNextPath } from "./route";

beforeEach(() => vi.clearAllMocks());

describe("password email links", () => {
  it.each(["invite", "recovery"])("does not consume %s tokens when a scanner follows the link repeatedly", async (type) => {
    for (let visit = 0; visit < 3; visit++) {
      const response = await GET(new NextRequest(`https://app.example/auth/confirm?token_hash=secret&type=${type}&next=https://evil.example`));
      const target = new URL(response.headers.get("location")!);
      expect(target.origin + target.pathname).toBe("https://app.example/auth/set-password");
      expect(target.searchParams.get("token_hash")).toBe("secret");
      expect(target.searchParams.get("type")).toBe(type);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    }
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("rejects missing tokens without contacting auth", async () => {
    const response = await GET(new NextRequest("https://app.example/auth/confirm?type=invite"));
    expect(response.headers.get("location")).toBe("https://app.example/login?error=invite");
    expect(createServerClient).not.toHaveBeenCalled();
  });
});

describe("safeNextPath", () => {
  it("keeps redirects inside the application", () => {
    expect(safeNextPath("/auth/set-password")).toBe("/auth/set-password");
    expect(safeNextPath("//malicious.example")).toBe("/calendar");
    expect(safeNextPath("/\\malicious.example")).toBe("/calendar");
    expect(safeNextPath("https://malicious.example")).toBe("/calendar");
    expect(safeNextPath("http://[")).toBe("/calendar");
  });
});
